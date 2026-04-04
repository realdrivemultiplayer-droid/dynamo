import { PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { getDB } from '../database/db.js';

export async function handleBanCommand(interaction) {
  try {
    const user = interaction.options.getUser('usuario');
    const reason = interaction.options.getString('razon') || 'Sin razón especificada';
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);

    if (!member) {
      return interaction.reply({ content: 'Usuario no encontrado en el servidor.', ephemeral: true });
    }

    if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) {
      return interaction.reply({ content: 'No tienes permisos para banear usuarios.', ephemeral: true });
    }

    if (member.roles.highest.position >= interaction.member.roles.highest.position) {
      return interaction.reply({ content: 'No puedes banear a este usuario.', ephemeral: true });
    }

    await interaction.guild.bans.create(user.id, { reason });
    const db = getDB();
    await db.none(
      'INSERT INTO mod_logs (guild_id, action, moderator_id, target_id, reason) VALUES ($1, $2, $3, $4, $5)',
      [interaction.guildId, 'BAN', interaction.user.id, user.id, reason]
    ).catch(() => {});

    return interaction.reply({ content: `Usuario ${user.tag} ha sido baneado. Razón: ${reason}` });
  } catch (error) {
    console.error('[MOD] Error en ban:', error);
    return interaction.reply({ content: 'Error al banear al usuario.', ephemeral: true });
  }
}

export async function handleKickCommand(interaction) {
  try {
    const user = interaction.options.getUser('usuario');
    const reason = interaction.options.getString('razon') || 'Sin razón especificada';
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);

    if (!member) {
      return interaction.reply({ content: 'Usuario no encontrado en el servidor.', ephemeral: true });
    }

    if (!interaction.member.permissions.has(PermissionFlagsBits.KickMembers)) {
      return interaction.reply({ content: 'No tienes permisos para expulsar usuarios.', ephemeral: true });
    }

    if (member.roles.highest.position >= interaction.member.roles.highest.position) {
      return interaction.reply({ content: 'No puedes expulsar a este usuario.', ephemeral: true });
    }

    await member.kick(reason);
    const db = getDB();
    await db.none(
      'INSERT INTO mod_logs (guild_id, action, moderator_id, target_id, reason) VALUES ($1, $2, $3, $4, $5)',
      [interaction.guildId, 'KICK', interaction.user.id, user.id, reason]
    ).catch(() => {});

    return interaction.reply({ content: `Usuario ${user.tag} ha sido expulsado. Razón: ${reason}` });
  } catch (error) {
    console.error('[MOD] Error en kick:', error);
    return interaction.reply({ content: 'Error al expulsar al usuario.', ephemeral: true });
  }
}

export async function handleMuteCommand(interaction) {
  try {
    const user = interaction.options.getUser('usuario');
    const minutes = interaction.options.getInteger('tiempo') || 10;
    const reason = interaction.options.getString('razon') || 'Sin razón especificada';
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);

    if (!member) {
      return interaction.reply({ content: 'Usuario no encontrado en el servidor.', ephemeral: true });
    }

    if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      return interaction.reply({ content: 'No tienes permisos para silenciar usuarios.', ephemeral: true });
    }

    const duration = minutes * 60 * 1000;
    await member.timeout(duration, reason);

    const db = getDB();
    await db.none(
      'INSERT INTO mod_logs (guild_id, action, moderator_id, target_id, reason) VALUES ($1, $2, $3, $4, $5)',
      [interaction.guildId, 'MUTE', interaction.user.id, user.id, `${minutes} minutos - ${reason}`]
    ).catch(() => {});

    return interaction.reply({ content: `Usuario ${user.tag} ha sido silenciado por ${minutes} minutos. Razón: ${reason}` });
  } catch (error) {
    console.error('[MOD] Error en mute:', error);
    return interaction.reply({ content: 'Error al silenciar al usuario.', ephemeral: true });
  }
}

export async function handleUnmuteCommand(interaction) {
  try {
    const user = interaction.options.getUser('usuario');
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);

    if (!member) {
      return interaction.reply({ content: 'Usuario no encontrado en el servidor.', ephemeral: true });
    }

    if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      return interaction.reply({ content: 'No tienes permisos para dessilenciar usuarios.', ephemeral: true });
    }

    await member.timeout(null);

    const db = getDB();
    await db.none(
      'INSERT INTO mod_logs (guild_id, action, moderator_id, target_id, reason) VALUES ($1, $2, $3, $4, $5)',
      [interaction.guildId, 'UNMUTE', interaction.user.id, user.id, 'Dessilenciado']
    ).catch(() => {});

    return interaction.reply({ content: `Usuario ${user.tag} ha sido dessilenciado.` });
  } catch (error) {
    console.error('[MOD] Error en unmute:', error);
    return interaction.reply({ content: 'Error al dessilenciar al usuario.', ephemeral: true });
  }
}

export async function handleWarnCommand(interaction) {
  try {
    const user = interaction.options.getUser('usuario');
    const reason = interaction.options.getString('razon') || 'Sin razón especificada';

    if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      return interaction.reply({ content: 'No tienes permisos para advertir usuarios.', ephemeral: true });
    }

    const db = getDB();
    await db.none(
      'INSERT INTO user_warnings (guild_id, user_id, moderator_id, reason) VALUES ($1, $2, $3, $4)',
      [interaction.guildId, user.id, interaction.user.id, reason]
    );

    const warnings = await db.one(
      'SELECT COUNT(*) as count FROM user_warnings WHERE guild_id = $1 AND user_id = $2',
      [interaction.guildId, user.id]
    );

    await db.none(
      'INSERT INTO mod_logs (guild_id, action, moderator_id, target_id, reason) VALUES ($1, $2, $3, $4, $5)',
      [interaction.guildId, 'WARN', interaction.user.id, user.id, reason]
    ).catch(() => {});

    return interaction.reply({ content: `Advertencia registrada para ${user.tag}. Total: ${warnings.count}/3. Razón: ${reason}` });
  } catch (error) {
    console.error('[MOD] Error en warn:', error);
    return interaction.reply({ content: 'Error al advertir al usuario.', ephemeral: true });
  }
}

export async function handleWarningsCommand(interaction) {
  try {
    const user = interaction.options.getUser('usuario');
    const db = getDB();

    const warnings = await db.any(
      'SELECT * FROM user_warnings WHERE guild_id = $1 AND user_id = $2 ORDER BY created_at DESC',
      [interaction.guildId, user.id]
    ).catch(() => []);

    if (warnings.length === 0) {
      return interaction.reply({ content: `${user.tag} no tiene advertencias.`, ephemeral: true });
    }

    const list = warnings.map((w, i) => `${i + 1}. ${w.reason}`).join('\n');
    const embed = new EmbedBuilder()
      .setColor('#FF6B6B')
      .setTitle(`Advertencias de ${user.tag}`)
      .setDescription(list)
      .setFooter({ text: `Total: ${warnings.length}/3` });

    return interaction.reply({ embeds: [embed] });
  } catch (error) {
    console.error('[MOD] Error en warnings:', error);
    return interaction.reply({ content: 'Error al obtener advertencias.', ephemeral: true });
  }
}

export async function handleClearCommand(interaction) {
  try {
    const amount = interaction.options.getInteger('cantidad');

    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
      return interaction.reply({ content: 'No tienes permisos para eliminar mensajes.', ephemeral: true });
    }

    const deleted = await interaction.channel.bulkDelete(amount, true);

    const db = getDB();
    await db.none(
      'INSERT INTO mod_logs (guild_id, action, moderator_id, target_id, reason) VALUES ($1, $2, $3, $4, $5)',
      [interaction.guildId, 'CLEAR', interaction.user.id, 'CHANNEL', `${deleted.size} mensajes eliminados`]
    ).catch(() => {});

    return interaction.reply({ content: `Se eliminaron ${deleted.size} mensajes.`, ephemeral: true });
  } catch (error) {
    console.error('[MOD] Error en clear:', error);
    return interaction.reply({ content: 'Error al eliminar mensajes.', ephemeral: true });
  }
}

export async function handleSlowmodeCommand(interaction) {
  try {
    const seconds = interaction.options.getInteger('segundos');

    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.reply({ content: 'No tienes permisos para cambiar el modo lento.', ephemeral: true });
    }

    await interaction.channel.setRateLimitPerUser(seconds);

    const db = getDB();
    await db.none(
      'INSERT INTO mod_logs (guild_id, action, moderator_id, target_id, reason) VALUES ($1, $2, $3, $4, $5)',
      [interaction.guildId, 'SLOWMODE', interaction.user.id, interaction.channelId, `${seconds} segundos`]
    ).catch(() => {});

    return interaction.reply({ content: `Modo lento establecido a ${seconds} segundos.`, ephemeral: true });
  } catch (error) {
    console.error('[MOD] Error en slowmode:', error);
    return interaction.reply({ content: 'Error al establecer modo lento.', ephemeral: true });
  }
}

export async function handleLockCommand(interaction) {
  try {
    const channel = interaction.options.getChannel('canal') || interaction.channel;

    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.reply({ content: 'No tienes permisos para bloquear canales.', ephemeral: true });
    }

    await channel.permissionOverwrites.edit(interaction.guild.id, { SendMessages: false });

    const db = getDB();
    await db.none(
      'INSERT INTO mod_logs (guild_id, action, moderator_id, target_id, reason) VALUES ($1, $2, $3, $4, $5)',
      [interaction.guildId, 'LOCK', interaction.user.id, channel.id, 'Canal bloqueado']
    ).catch(() => {});

    return interaction.reply({ content: `Canal ${channel} ha sido bloqueado.`, ephemeral: true });
  } catch (error) {
    console.error('[MOD] Error en lock:', error);
    return interaction.reply({ content: 'Error al bloquear el canal.', ephemeral: true });
  }
}

export async function handleUnlockCommand(interaction) {
  try {
    const channel = interaction.options.getChannel('canal') || interaction.channel;

    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.reply({ content: 'No tienes permisos para desbloquear canales.', ephemeral: true });
    }

    await channel.permissionOverwrites.edit(interaction.guild.id, { SendMessages: null });

    const db = getDB();
    await db.none(
      'INSERT INTO mod_logs (guild_id, action, moderator_id, target_id, reason) VALUES ($1, $2, $3, $4, $5)',
      [interaction.guildId, 'UNLOCK', interaction.user.id, channel.id, 'Canal desbloqueado']
    ).catch(() => {});

    return interaction.reply({ content: `Canal ${channel} ha sido desbloqueado.`, ephemeral: true });
  } catch (error) {
    console.error('[MOD] Error en unlock:', error);
    return interaction.reply({ content: 'Error al desbloquear el canal.', ephemeral: true });
  }
}

export async function handleAntiSpamCommand(interaction) {
  try {
    const state = interaction.options.getString('estado') === 'on';

    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: 'No tienes permisos para cambiar esta configuración.', ephemeral: true });
    }

    const db = getDB();
    await db.none(
      'INSERT INTO mod_settings (guild_id, anti_spam) VALUES ($1, $2) ON CONFLICT (guild_id) DO UPDATE SET anti_spam = $2',
      [interaction.guildId, state]
    );

    return interaction.reply({ content: `Anti-spam ${state ? 'activado' : 'desactivado'}.`, ephemeral: true });
  } catch (error) {
    console.error('[MOD] Error en anti-spam:', error);
    return interaction.reply({ content: 'Error al cambiar configuración.', ephemeral: true });
  }
}

export async function handleAntiBotCommand(interaction) {
  try {
    const state = interaction.options.getString('estado') === 'on';

    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: 'No tienes permisos para cambiar esta configuración.', ephemeral: true });
    }

    const db = getDB();
    await db.none(
      'INSERT INTO mod_settings (guild_id, anti_bot) VALUES ($1, $2) ON CONFLICT (guild_id) DO UPDATE SET anti_bot = $2',
      [interaction.guildId, state]
    );

    return interaction.reply({ content: `Anti-bot ${state ? 'activado' : 'desactivado'}.`, ephemeral: true });
  } catch (error) {
    console.error('[MOD] Error en anti-bot:', error);
    return interaction.reply({ content: 'Error al cambiar configuración.', ephemeral: true });
  }
}

export async function handleAntiRaidCommand(interaction) {
  try {
    const state = interaction.options.getString('estado') === 'on';

    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: 'No tienes permisos para cambiar esta configuración.', ephemeral: true });
    }

    const db = getDB();
    await db.none(
      'INSERT INTO mod_settings (guild_id, anti_raid) VALUES ($1, $2) ON CONFLICT (guild_id) DO UPDATE SET anti_raid = $2',
      [interaction.guildId, state]
    );

    return interaction.reply({ content: `Anti-raid ${state ? 'activado' : 'desactivado'}.`, ephemeral: true });
  } catch (error) {
    console.error('[MOD] Error en anti-raid:', error);
    return interaction.reply({ content: 'Error al cambiar configuración.', ephemeral: true });
  }
}
