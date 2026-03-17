import { PermissionsBitField } from 'discord.js';
import { getDB } from '../database/db.js';

// ⏱️ Cooldown en memoria (anti-spam)
const cooldowns = new Map();

export async function handleLevelup(message, config) {
    if (!message.guild || !message.member || message.author.bot) return;

    const db = getDB();

    // 🔥 COOLDOWN (15 segundos)
    const now = Date.now();
    const lastXp = cooldowns.get(message.author.id) || 0;

    if (now - lastXp < 15000) return;
    cooldowns.set(message.author.id, now);

    // 🔥 XP FIJO
    const xpGain = 1;

    let user = await db.get(
        'SELECT * FROM users WHERE user_id = ?', 
        [message.author.id]
    );

    if (!user) {
        await db.run(
            'INSERT INTO users (user_id, username, level, xp) VALUES (?, ?, 1, ?)', 
            [message.author.id, message.author.username, xpGain]
        );
        return;
    }

    const newXp = user.xp + xpGain;

    // 🔥 ESCALADO DE XP
    const nextLevelXp = (user.level + 1) * 100;

    if (newXp >= nextLevelXp) {
        const newLevel = user.level + 1;

        const oldRoleId = config[`LEVEL_ID_${user.level}`];
        const newRoleId = config[`LEVEL_ID_${newLevel}`];

        try {
            // 🔻 Remover rol anterior
            if (oldRoleId) {
                const oldRole = message.guild.roles.cache.get(oldRoleId);
                if (oldRole && message.member.roles.cache.has(oldRole.id)) {
                    await message.member.roles.remove(oldRole).catch(() => {});
                }
            }

            // 🔺 Agregar nuevo rol
            if (newRoleId) {
                const newRole = message.guild.roles.cache.get(newRoleId);
                if (newRole && !message.member.roles.cache.has(newRole.id)) {
                    await message.member.roles.add(newRole).catch(() => {});
                }
            }

            // 💾 Actualizar DB
            await db.run(
                'UPDATE users SET level = ?, xp = 0 WHERE user_id = ?', 
                [newLevel, message.author.id]
            );

            // 📢 Canal de niveles
            const levelChannelId = config.levels_channel_id;

            if (levelChannelId) {
                const levelChannel = message.guild.channels.cache.get(levelChannelId);

                if (levelChannel && levelChannel.isTextBased()) {
                    await levelChannel.send(
                        `🎉 **${message.author.username}** alcanzó el **Rango ${newLevel}**.`
                    ).catch(() => {});
                }
            }

        } catch (error) {
            console.error('Error en levelup:', error);
        }

    } else {
        await db.run(
            'UPDATE users SET xp = ? WHERE user_id = ?', 
            [newXp, message.author.id]
        );
    }
}

export async function handleModeration(message, config) {
    if (!message.guild || !message.member) return;

    const db = getDB();

    if (message.content.startsWith('!warn')) {
        const target = message.mentions.members.first();
        if (!target) return;

        if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
            await message.reply('No tienes permisos para advertir usuarios');
            return;
        }

        try {
            let user = await db.get(
                'SELECT * FROM users WHERE user_id = ?', 
                [target.id]
            );

            const warnings = (user?.warnings || 0) + 1;

            if (!user) {
                await db.run(
                    'INSERT INTO users (user_id, username, warnings) VALUES (?, ?, ?)', 
                    [target.id, target.user.username, warnings]
                );
            } else {
                await db.run(
                    'UPDATE users SET warnings = ? WHERE user_id = ?', 
                    [warnings, target.id]
                );
            }

            await message.reply(`⚠️ ${target} ha recibido una advertencia (${warnings}/3)`);

            if (warnings >= 3) {
                await target.ban({ reason: 'Exceso de advertencias' }).catch(() => {});
                await message.reply(`🔨 ${target} ha sido baneado por exceso de advertencias`);
            }

        } catch (error) {
            console.error('Error en moderación:', error);
        }
    }
}