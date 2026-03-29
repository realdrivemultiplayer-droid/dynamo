import { PermissionsBitField, EmbedBuilder } from 'discord.js';
import { getDB } from '../database/db.js';

// Anti-spam
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

    // Remover rol de nivel anterior
    const oldLevelRole = levelRoles.find(lr => lr.level === oldLevel);
    if (oldLevelRole && member.roles.cache.has(oldLevelRole.role_id)) {
      await member.roles.remove(oldLevelRole.role_id).catch(() => {});
    }

    // Asignar rol de nuevo nivel
    const newLevelRole = levelRoles.find(lr => lr.level === newLevel);
    if (newLevelRole && !member.roles.cache.has(newLevelRole.role_id)) {
      await member.roles.add(newLevelRole.role_id).catch(err => {
        console.warn(`[LEVELS] Error de jerarquía: No se pudo asignar el rol ${newLevelRole.role_id}: ${err.message}`);
      });
    }
  } catch (err) {
    console.error('[LEVELS] Error en updateLevelRole:', err);
  }
}

/**
 * Envía una notificación de nivel optimizada para legibilidad y profesionalismo
 */
async function sendLevelUpMessage(guild, member, oldLevel, newLevel, totalXp, levelsChannelId) {
  try {
    if (!levelsChannelId) return;

    const levelChannel = guild.channels.cache.get(levelsChannelId);
    if (!levelChannel || !levelChannel.isTextBased()) return;

    const nextLevelXp = getXpForNextLevel(newLevel);
    const xpProgress = totalXp - (newLevel * 100);
    const xpNeeded = 100;

    const levelEmbed = new EmbedBuilder()
      .setColor('#2F3136') // Gris oscuro profesional
      .setAuthor({ 
        name: member.user.tag, 
        iconURL: member.user.displayAvatarURL({ dynamic: true }) 
      })
      .setTitle('Actualización de Nivel')
      .setDescription(`El usuario **${member.user.username}** ha incrementado su nivel de actividad en **${guild.name}**.`)
      .addFields(
        { name: 'Progreso de Nivel', value: `Nivel ${oldLevel} a Nivel ${newLevel}`, inline: false },
        { name: 'Experiencia Acumulada', value: `${totalXp} XP`, inline: false },
        { name: 'Siguiente Objetivo', value: `${xpNeeded - xpProgress} XP restantes para el nivel ${newLevel + 1}`, inline: false }
      )
      .setFooter({ text: `Sistema de Niveles | ${guild.name}` })
      .setTimestamp();

    await levelChannel.send({ 
      content: `Confirmación de ascenso: ${member}`, 
      embeds: [levelEmbed] 
    }).catch(() => {});

  } catch (err) {
    console.error('[LEVELS] Error en sendLevelUpMessage:', err);
  }
}

export async function handleLevelup(message, config) {
  try {
    if (!message || !message.guild || !message.member || message.author.bot) return;

    const now = Date.now();
    const lastMsg = cooldowns.get(message.author.id) || 0;
    if (now - lastMsg < 5000) return;
    cooldowns.set(message.author.id, now);

    const db = getDB();
    const guildId = message.guild.id;
    const userId = message.author.id;
    const xpGain = 100;

    let user = await db.oneOrNone(
      'SELECT * FROM users WHERE user_id = $1 AND guild_id = $2',
      [userId, guildId]
    ).catch(() => null);

    if (!user) {
      await db.none(
        'INSERT INTO users (user_id, guild_id, username, level, xp, total_xp) VALUES ($1, $2, $3, 0, 0, 0)',
        [userId, guildId, message.author.username]
      ).catch(err => console.error('[LEVELS] Error en creación de registro:', err));
      
      user = { total_xp: 0, level: 0 };
    }

    const oldTotalXp = parseInt(user.total_xp) || 0;
    const newTotalXp = oldTotalXp + xpGain;
    const oldLevel = getLevelFromXp(oldTotalXp);
    const newLevel = getLevelFromXp(newTotalXp);

    await db.none(
      'UPDATE users SET xp = $1, total_xp = $2, level = $3 WHERE user_id = $4 AND guild_id = $5',
      [newTotalXp % 100, newTotalXp, newLevel, userId, guildId]
    ).catch(err => console.error('[LEVELS] Error en actualización de datos:', err));

    if (newLevel > oldLevel) {
      await updateLevelRole(message.member, guildId, oldLevel, newLevel);
      await sendLevelUpMessage(message.guild, message.member, oldLevel, newLevel, newTotalXp, config?.levels_channel_id);
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
      message.reply('Permisos insuficientes para ejecutar esta acción.').catch(() => {});
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

    message.reply(`Advertencia registrada para ${target}. Estado: ${warnings}/3.`).catch(() => {});

    if (warnings >= 3) {
      await target.ban({ reason: 'Límite de advertencias alcanzado (3/3).' }).catch(() => {});
      message.reply(`El usuario ${target} ha sido sancionado con baneo definitivo por acumulación de advertencias.`).catch(() => {});
    }
  } catch (error) {
    console.error('[LEVELS] Error en moderación:', error);
  }
}
