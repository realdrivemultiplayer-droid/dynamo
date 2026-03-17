import { ChannelType, PermissionsBitField, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getDB } from '../database/db.js';
import { getConfig } from './config-manager.js';

// Guard de creación por usuario+guild para evitar doble-click
const creating = new Set();

/**
 * 1. FUNCIÓN DE CONFIGURACIÓN AUTOMÁTICA
 * Llama a esta función justo después de que el comando de configuración asigne el canal.
 * Ej: await enviarPanelDeTickets(message.guild.channels.cache.get(ticketChannelId));
 */
export async function enviarPanelDeTickets(channel) {
    if (!channel) return;

    const embed = new EmbedBuilder()
        .setColor('#2F3136') // Tono oscuro/profesional
        .setTitle('Soporte Técnico')
        .setDescription('Haz clic en el botón de abajo para crear tu ticket de soporte. Un moderador te atenderá en breve.');

    const btn = new ButtonBuilder()
        .setCustomId('btn_open_ticket')
        .setLabel('Crea tu Ticket')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🎫');

    const row = new ActionRowBuilder().addComponents(btn);

    await channel.send({ embeds: [embed], components: [row] });
}

/**
 * 2. MANEJADOR DE MENSAJES (Respaldo para !close)
 * Debe llamarse desde tu evento 'messageCreate'
 */
export async function handleTicketMessage(message) {
    if (!message.guild || message.author.bot) return false;

    if (message.content.toLowerCase() === '!close') {
        const config = getConfig(message.guild.id);
        const db = getDB();
        const isTicket = await db.get(
            'SELECT id FROM tickets WHERE channel_id = ? AND status = ?',
            [message.channel.id, 'open']
        );
        if (isTicket) {
            await closeTicket(message, config, false);
            return true;
        }
    }
    return false;
}

/**
 * 3. MANEJADOR DE INTERACCIONES (Botones)
 * Debe llamarse desde tu evento 'interactionCreate'
 */
export async function handleTicketInteraction(interaction) {
    if (!interaction.isButton() || !interaction.guild) return false;

    const config = getConfig(interaction.guild.id);

    if (interaction.customId === 'btn_open_ticket') {
        await createTicketFromButton(interaction, config);
        return true;
    }

    if (interaction.customId === 'btn_close_ticket') {
        await closeTicket(interaction, config, true);
        return true;
    }

    return false;
}

// LÓGICA INTERNA: Crear Ticket
async function createTicketFromButton(interaction, config) {
    const ticketCategoryId = config.ticket_category_id?.trim() || '';
    if (!ticketCategoryId) {
        return interaction.reply({ content: 'La categoría de tickets no está configurada.', ephemeral: true });
    }

    const guardKey = `${interaction.guild.id}:${interaction.user.id}`;
    if (creating.has(guardKey)) {
        return interaction.reply({ content: 'Ya se está creando tu ticket, espera un momento...', ephemeral: true });
    }
    creating.add(guardKey);

    const db = getDB();

    try {
        const existing = await db.get(
            'SELECT * FROM tickets WHERE user_id = ? AND guild_id = ? AND status = ?',
            [interaction.user.id, interaction.guild.id, 'open']
        );

        if (existing) {
            const existingChannel = interaction.guild.channels.cache.get(existing.channel_id);
            if (existingChannel) {
                return interaction.reply({
                    content: `Ya tienes un ticket abierto en <#${existing.channel_id}>. Usa el botón o \`!close\` ahí para cerrarlo primero.`,
                    ephemeral: true
                });
            }
            db.run(
                'UPDATE tickets SET status = ?, closed_at = CURRENT_TIMESTAMP WHERE id = ?',
                ['closed', existing.id]
            ).catch(() => {});
        }

        await interaction.deferReply({ ephemeral: true });

        const safeUsername = interaction.user.username
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .slice(0, 20) || 'usuario';

        const staffRoleIds = (config.ticket_staff_roles || '')
            .split(',').map(r => r.trim()).filter(Boolean);

        const permissionOverwrites = [
            { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
            {
                id: interaction.user.id,
                allow: [
                    PermissionsBitField.Flags.ViewChannel,
                    PermissionsBitField.Flags.SendMessages,
                    PermissionsBitField.Flags.AttachFiles,
                    PermissionsBitField.Flags.EmbedLinks,
                    PermissionsBitField.Flags.ReadMessageHistory
                ]
            }
        ];

        let staffMentions = '';
        for (const roleId of staffRoleIds) {
            if (interaction.guild.roles.cache.has(roleId)) {
                staffMentions += `<@&${roleId}> `; // Acumula las menciones de los roles
                permissionOverwrites.push({
                    id: roleId,
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.AttachFiles,
                        PermissionsBitField.Flags.EmbedLinks,
                        PermissionsBitField.Flags.ReadMessageHistory,
                        PermissionsBitField.Flags.ManageChannels
                    ]
                });
            }
        }

        const ticketChannel = await interaction.guild.channels.create({
            name: `ticket-${safeUsername}`,
            type: ChannelType.GuildText,
            parent: ticketCategoryId,
            permissionOverwrites
        });

        const now = new Date();
        const dateStr = now.toLocaleDateString('es-ES');
        const timeStr = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

        const embed = new EmbedBuilder()
            .setColor('#FF8C00')
            .setTitle('Ticket Abierto')
            .setThumbnail(interaction.user.displayAvatarURL({ size: 64, extension: 'png' }))
            .setDescription(
                `Hola <@${interaction.user.id}>, el equipo de soporte atenderá tu solicitud en breve.\n\n` +
                `**Fecha:** ${dateStr} — **Hora:** ${timeStr}`
            )
            .setFooter({ text: 'Los moderadores pueden usar el botón abajo para cerrar.' })
            .setTimestamp();

        // Botón de cerrar para el interior del ticket
        const closeBtn = new ButtonBuilder()
            .setCustomId('btn_close_ticket')
            .setLabel('Cerrar Ticket')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🔒');

        const row = new ActionRowBuilder().addComponents(closeBtn);

        // Envía la mención a los moderadores fuera del embed para que la notificación suene
        await ticketChannel.send({
            content: `<@${interaction.user.id}> ${staffMentions.trim()}`,
            embeds: [embed],
            components: [row]
        });

        db.run(
            'INSERT INTO tickets (user_id, guild_id, channel_id, reason, status) VALUES (?, ?, ?, ?, ?)',
            [interaction.user.id, interaction.guild.id, ticketChannel.id, 'Creado vía panel', 'open']
        ).catch(err => console.error('Error guardando ticket en DB:', err.message));

        console.log(`[${interaction.guild.name}] Ticket creado para ${interaction.user.username} -> #${ticketChannel.name}`);

        await interaction.editReply({ content: `¡Tu ticket ha sido creado exitosamente! Míralo aquí: <#${ticketChannel.id}>` });

    } catch (error) {
        console.error(`[${interaction.guild.name}] Error creando ticket:`, error.code, error.message);
        let errorMsg = 'Ocurrió un error al crear tu ticket. Contacta a un administrador.';
        if (error.code === 50013) errorMsg = 'El bot no tiene el permiso **Gestionar Canales**.';
        if (error.code === 50001) errorMsg = 'El bot no tiene acceso a la categoría de tickets.';
        
        if (interaction.deferred) {
            await interaction.editReply({ content: errorMsg }).catch(() => {});
        } else {
            await interaction.reply({ content: errorMsg, ephemeral: true }).catch(() => {});
        }
    } finally {
        creating.delete(guardKey);
    }
}

// LÓGICA INTERNA: Cerrar Ticket
async function closeTicket(ctx, config, isInteraction) {
    if (!ctx.guild) return;
    const db = getDB();

    const staffRoles = (config.ticket_staff_roles || '')
        .split(',').map(r => r.trim()).filter(Boolean);

    const isStaff =
        ctx.member.permissions.has(PermissionsBitField.Flags.ManageChannels) ||
        staffRoles.some(id => ctx.member.roles.cache.has(id));

    // Validar: Solo moderadores pueden usar el botón
    if (isInteraction && !isStaff) {
        return ctx.reply({ content: 'Solo los moderadores pueden usar el botón para cerrar tickets.', ephemeral: true });
    }

    const channelId = isInteraction ? ctx.channelId : ctx.channel.id;
    const authorId = isInteraction ? ctx.user.id : ctx.author.id;

    const ticket = await db.get(
        'SELECT * FROM tickets WHERE channel_id = ? AND status = ?',
        [channelId, 'open']
    ).catch(() => null);

    const isOwner = ticket?.user_id === authorId;

    // Validar: El comando !close puede ser usado por el dueño o el staff
    if (!isInteraction && !isStaff && !isOwner) {
        return ctx.reply('No tienes permiso para cerrar este ticket.')
            .then(w => setTimeout(() => w.delete().catch(() => {}), 5000))
            .catch(() => {});
    }

    const embed = new EmbedBuilder()
        .setColor('#FF4444')
        .setTitle('Ticket Cerrado')
        .setDescription(`Ticket cerrado por <@${authorId}>.\nEste canal se eliminará en **5 segundos**.`)
        .setTimestamp();

    if (isInteraction) {
        await ctx.reply({ embeds: [embed] }).catch(() => {});
    } else {
        await ctx.channel.send({ embeds: [embed] }).catch(() => {});
    }

    await db.run(
        'UPDATE tickets SET status = ?, closed_at = CURRENT_TIMESTAMP WHERE channel_id = ?',
        ['closed', channelId]
    ).catch(() => {});

    setTimeout(() => {
        ctx.channel.delete().catch(err =>
            console.error('Error eliminando canal de ticket:', err.message)
        );
    }, 5000);

    const userName = isInteraction ? ctx.user.username : ctx.author.username;
    console.log(`[${ctx.guild.name}] Ticket cerrado por ${userName}`);
}
