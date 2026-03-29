import { PermissionsBitField, EmbedBuilder } from 'discord.js';
import { getDB } from '../database/db.js';

// 🔒 Anti-spam
const cooldowns = new Map();

/**
 * Calcula el nivel basado en XP total
 */
function getLevelFromXp(totalXp) {
  return Math.floor(totalXp / 100);
}

/**
 * Calcula el XP necesario para alcanzar el siguiente nivel
 */
function getXpForNextLevel(currentLevel) {
  return (currentLevel + 1) * 100;
}

/**
 * Actualiza los roles de nivel del usuario
 */
async function updateLevelRole(member, guildId, oldLevel, newLevel) {
  try {
    const db = getDB();
    
    const levelRoles = await db.any(
      'SELECT * FROM level_roles WHERE guild_id = $1 ORDER BY level ASC',
      [guildId]
    ).catch(() => []);

    if (!levelRoles.length) return;

    // Quitar rol del nivel anterior
    const oldLevelRole = levelRoles.find(lr => lr.level === oldLevel);
    if (oldLevelRole && member.roles.cache.has(oldLevelRole.role_id)) {
      await member.roles.remove(oldLevelRole.role_id).catch(() => {});
    }

    // Asignar rol del nuevo nivel
    const newLevelRole = levelRoles.find(lr => lr.level === newLevel);
    if (newLevelRole && !member.roles.cache.has(newLevelRole.role_id)) {
      await member.roles.add(newLevelRole.role_id).catch(err => {
        console.warn(`[LEVELS] Error asignando rol: ${err.message}. Revisa la jerarquía del bot.`);
      });
    }
  } catch (err) {
    console.error('[LEVELS] Error en updateLevelRole:', err);
  }
}

/**
 * Envía un mensaje profesional con EMBED (Color lateral y Avatar pequeño)
 */
async function sendLevelUpMessage(guild, member, oldLevel, newLevel, totalXp, levelsChannelId) {
  try {
    if (!levelsChannelId) return;

    const levelChannel = guild.channels.cache.get(levelsChannelId);
    if (!levelChannel || !levelChannel.isTextBased()) return;

    const nextLevelXp = getXpForNextLevel(newLevel);
    const xpProgress = totalXp - (newLevel * 100);
    const xpNeeded = nextLevelXp - (newLevel * 100);

    // Diseño profesional del mensaje
    const levelEmbed = new EmbedBuilder()
      .setColor('#5865F2') // Color de la barra lateral (puedes cambiarlo a tu gusto)
      .setAuthor({ 
        name: `${member.user.username} ha subido de nivel`, 
        iconURL: member.user.displayAvatarURL({ dynamic: true }) 
      }) // Foto pequeña arriba a la izquierda con el nombre
      .setTitle('✨ ¡Felicidades! ✨')
      .setDescription(`¡Has alcanzado una nueva meta en **${guild.name}**!`)
      .addFields(
        { name: 'Nivel', value: `\`${oldLevel}\` ➔ **${newLevel}**`, inline: true },
        { name: 'XP Total', value: `\`${totalXp}\``, inline: true },
        { name: 'Progreso', value: `**${xpProgress}** / **${xpNeeded}** XP para el nivel ${newLevel + 1}` }
      )
      .setTimestamp()
      .setFooter({ text: 'Sigue participando para desbloquear más recompensas' });

    await levelChannel.send({ 
      content: `¡Enhorabuena ${member}!`, // Menciona al usuario fuera del cuadro para que le llegue la notificación
      embeds: [levelEmbed] 
    }).catch(() => {});

  } catch (err) {
    console.error('[LEVELS] Error en sendLevelUpMessage:', err);
  }
}

export async function handleLevelup(message, config) {
  try {
    if (!message || !message.guild || !message.member || message.author.bot) return;

    // Anti-spam: 5 segundos
    const now = Date.now();
    const lastMsg = cooldowns.get(message.author.id) || 0;
    if (now - lastMsg < 5000) return;
    cooldowns.set(message.author.id, now);

    const db = getDB();
    const guildId = message.guild.id;
    const userId = message.author.id;
    const xpGain = 100; // Esto asegura que suba al nivel 1 al primer mensaje

    let user = await db.oneOrNone(
      'SELECT * FROM users WHERE user_id = $1 AND guild_id = $2',
      [userId, guildId]
    ).catch(() => null);

    // Si el usuario no existe en la DB
    if (!user) {
      await db.none(
        'INSERT INTO users (user_id, guild_id, username, level, xp, total_xp) VALUES ($1, $2, $3, 0, 0, 0)',
        [userId, guildId, message.author.username]
      ).catch(err => console.error('[LEVELS] Error creando user:', err));
      
      user = { total_xp: 0, level: 0 };
    }

    const oldTotalXp = parseInt(user.total_xp) || 0;
    const newTotalXp = oldTotalXp + xpGain;
    const oldLevel = getLevelFromXp(oldTotalXp);
    const newLevel = getLevelFromXp(newTotalXp);

    // Actualizamos la base de datos con los nuevos valores
    await db.none(
      'UPDATE users SET xp = $1, total_xp = $2, level = $3 WHERE user_id = $4 AND guild_id = $5',
      [newTotalXp % 100, newTotalXp, newLevel, userId, guildId]
    ).catch(err => console.error('[LEVELS] Error actualizando XP:', err));

    // Si hubo cambio de nivel
    if (newLevel > oldLevel) {
      console.log(`[LEVELS] ${message.author.username} subió al nivel ${newLevel} en ${message.guild.name}`);

      // 1. Intentar asignar/quitar ROLES
      await updateLevelRole(message.member, guildId, oldLevel, newLevel);

      // 2. Enviar el mensaje con EMBED bacano
      await sendLevelUpMessage(
        message.guild,
        message.member,
        oldLevel,
        newLevel,
        newTotalXp,
        config?.levels_channel_id
      );
    }
  } catch (error) {
    console.error('[LEVELS] Error en handleLevelup:', error);
  }
}

export async function handleModeration(message, config) {
  try {
    if (!message.content.startsWith('!warn')) return;

    const target = message.mentions.members.first();
    if (!target) return;

    if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
      message.reply('No tienes permiso para advertir usuarios.').catch(() => {});
      return;
    }

    const db = getDB();
    const guildId = message.guild.id;

    let user = await db.oneOrNone(
      'SELECT * FROM users WHERE user_id = $1 AND guild_id = $2',
      [target.id, guildId]
    ).catch(() => null);

    const warnings = (user?.warnings || 0) + 1;

    if (!user) {
      await db.none(
        'INSERT INTO users (user_id, guild_id, username, warnings) VALUES ($1, $2, $3, $4)',
        [target.id, guildId, target.user.username, warnings]
      ).catch(() => {});
    } else {
      await db.none(
        'UPDATE users SET warnings = $1 WHERE user_id = $2 AND guild_id = $3',
        [warnings, target.id, guildId]
      ).catch(() => {});
    }

    message.reply(`${target} ha recibido una advertencia (${warnings}/3).`).catch(() => {});

    if (warnings >= 3) {
      await target.ban({ reason: 'Exceso de advertencias' }).catch(() => {});
      message.reply(`${target} ha sido baneado por acumular 3 advertencias.`).catch(() => {});
    }
  } catch (error) {
    console.error('[LEVELS] Error en Moderación:', error);
  }
}
