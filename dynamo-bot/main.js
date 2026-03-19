import fs from 'fs';
import {
    Client, GatewayIntentBits, Partials, ActivityType,
    REST, Routes, SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder
} from 'discord.js';
import express from 'express';
import { initDB, getDB } from './database/db.js';

// --- Ajuste de Importación (Compatibilidad CommonJS) ---
import configPkg from './modules/config-manager.js';
const { loadAllGuildConfigs, initGuildConfig, getConfig, setConfig } = configPkg;

import { handleIA } from './modules/ia.js';
import { handleMemberJoin, handleMemberRemove } from './modules/welcome.js';
import { handleTicketCreation } from './modules/tickets.js';
import { handleReaction } from './modules/voting.js';
import { handleLevelup, handleModeration } from './modules/levels.js';
import { handlePlay, handlePause, handleSkip, handleStop, handleQueue } from './modules/music.js';
import {
    onChannelCreate, onChannelDelete, onChannelUpdate,
    onRoleCreate, onRoleDelete, onRoleUpdate,
    onGuildUpdate, onGuildBanAdd, onNewBot, onMessageDelete
} from './modules/logs.js';

const DYNAMO_PATH = './dynamo.sf';

function readConfig(filePath) {
    if (!fs.existsSync(filePath)) return {};
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const config  = {};
        content.split('\n').forEach(line => {
            const parts = line.split('=');
            if (parts.length >= 2 && !line.startsWith('#')) {
                const key = parts[0].trim();
                const val = parts.slice(1).join('=').trim().replace(/^"|"$/g, '');
                config[key] = val;
            }
        });
        return config;
    } catch (e) {
        console.error('Error leyendo config:', e);
        return {};
    }
}

let globalConfig = { ...process.env, ...readConfig(DYNAMO_PATH) };

// ─── Slash commands ──────────────────────────────────────────────────
const slashCommands = [
    new SlashCommandBuilder()
        .setName('play')
        .setDescription('Reproduce una cancion en el canal de voz')
        .addStringOption(opt => opt.setName('query').setDescription('Nombre o URL de la cancion').setRequired(true)),
    new SlashCommandBuilder().setName('pause').setDescription('Pausa o reanuda la cancion actual'),
    new SlashCommandBuilder().setName('change').setDescription('Cambia a la siguiente cancion en la cola'),
    new SlashCommandBuilder().setName('disconnect').setDescription('Desconecta el bot del canal de voz'),
    new SlashCommandBuilder().setName('queue').setDescription('Muestra la cola de reproduccion'),
    new SlashCommandBuilder()
        .setName('ia')
        .setDescription('Gestiona el asistente de IA')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub => sub.setName('enable').setDescription('Activa el asistente de IA'))
        .addSubcommand(sub => sub.setName('disable').setDescription('Desactiva el asistente de IA')),
    new SlashCommandBuilder()
        .setName('config')
        .setDescription('Configura Dynamo para este servidor')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub => sub.setName('welcome').setDescription('Canal bienvenida').addChannelOption(o => o.setName('channel').setDescription('Canal').setRequired(true).addChannelTypes(ChannelType.GuildText)))
        .addSubcommand(sub => sub.setName('exit').setDescription('Canal salida').addChannelOption(o => o.setName('channel').setDescription('Canal').setRequired(true).addChannelTypes(ChannelType.GuildText)))
        .addSubcommand(sub => sub.setName('levels').setDescription('Canal niveles').addChannelOption(o => o.setName('channel').setDescription('Canal').setRequired(true).addChannelTypes(ChannelType.GuildText)))
        .addSubcommand(sub => sub.setName('logs').setDescription('Canal logs').addChannelOption(o => o.setName('channel').setDescription('Canal').setRequired(true).addChannelTypes(ChannelType.GuildText)))
        .addSubcommand(sub => sub.setName('ticket').setDescription('Canal tickets').addChannelOption(o => o.setName('channel').setDescription('Canal').setRequired(true).addChannelTypes(ChannelType.GuildText)))
        .addSubcommand(sub => sub.setName('ticket-category').setDescription('Categoria tickets').addStringOption(o => o.setName('id').setDescription('ID de categoria').setRequired(true)))
        .addSubcommand(sub => sub.setName('ticket-staff').setDescription('Rol staff tickets').addRoleOption(o => o.setName('rol').setDescription('Rol').setRequired(true)))
        .addSubcommand(sub => sub.setName('music').setDescription('Canal musica').addChannelOption(o => o.setName('channel').setDescription('Canal').addChannelTypes(ChannelType.GuildText)))
        .addSubcommand(sub => sub.setName('level-rol').setDescription('Configura un rol por XP').addRoleOption(o => o.setName('rol').setDescription('Rol').setRequired(true)).addIntegerOption(o => o.setName('xp').setDescription('XP requerido').setRequired(true).setMinValue(1)))
        .addSubcommand(sub => sub.setName('autorole').setDescription('Rol automatico al entrar').addRoleOption(o => o.setName('rol').setDescription('Rol').setRequired(true)))
        .addSubcommand(sub => sub.setName('ver').setDescription('Muestra la configuracion actual')),
].map(cmd => cmd.toJSON());

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildModeration
    ],
    partials: [Partials.Channel, Partials.Message, Partials.User, Partials.Reaction]
});

// ─── Web Server ──────────────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 5000;
app.get('/', (_req, res) => res.send('Dynamo activo'));
app.listen(PORT, '0.0.0.0', () => console.log(`[OK] Servidor en puerto ${PORT}`));

// ─── Ready ──────────────────────────────────────────────────────────
client.on('ready', async () => {
    console.log(`[OK] Dynamo activo: ${client.user.tag}`);
    client.user.setPresence({
        status: 'online',
        activities: [{ name: globalConfig.STATUS || 'Sloet Froom', type: ActivityType.Watching }]
    });

    await loadAllGuildConfigs(client.guilds.cache);

    try {
        const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
        await Promise.all(
            [...client.guilds.cache.values()].map(guild =>
                rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body: slashCommands })
                .catch(err => console.error(`Error en ${guild.name}:`, err.message))
            )
        );
        console.log(`[OK] Slash commands sincronizados`);
    } catch (error) {
        console.error('Error en REST:', error);
    }

    setInterval(() => {
        globalConfig = { ...process.env, ...readConfig(DYNAMO_PATH) };
    }, 30000);
});

client.on('guildCreate', async (guild) => {
    await initGuildConfig(guild.id);
    const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
    rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body: slashCommands }).catch(() => {});
});

// ─── Handlers ───────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    try {
        switch (interaction.commandName) {
            case 'play':       return await handlePlay(interaction);
            case 'pause':      return await handlePause(interaction);
            case 'change':     return await handleSkip(interaction);
            case 'disconnect': return await handleStop(interaction);
            case 'queue':      return await handleQueue(interaction);
            case 'ia':         return await handleIACommand(interaction);
            case 'config':     return await handleConfigCommand(interaction);
        }
    } catch (error) {
        console.error('Error interacción:', error);
    }
});

async function handleIACommand(interaction) {
    const sub = interaction.options.getSubcommand();
    const enabled = sub === 'enable' ? 1 : 0;
    await setConfig(interaction.guildId, 'ia_enabled', enabled);
    await interaction.reply({ content: `IA ${enabled ? 'activada' : 'desactivada'}.`, ephemeral: true });
}

async function handleConfigCommand(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (sub === 'ver') {
        const cfg = await getConfig(guildId);
        const db = getDB();
        const levelRoles = await db.all('SELECT * FROM level_roles WHERE guild_id = ? ORDER BY xp_required ASC', [guildId]);
        const lrStr = levelRoles.length ? levelRoles.map(lr => `<@&${lr.role_id}> — ${lr.xp_required} XP`).join('\n') : 'No configurado';

        const embed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('Configuración de Dynamo')
            .addFields(
                { name: 'Bienvenida', value: cfg?.welcome_channel_id ? `<#${cfg.welcome_channel_id}>` : 'No configurado', inline: true },
                { name: 'Logs', value: cfg?.logs_channel_id ? `<#${cfg.logs_channel_id}>` : 'No configurado', inline: true },
                { name: 'IA', value: cfg?.ia_enabled !== 0 ? 'Activa' : 'Desactivada', inline: true },
                { name: 'Roles Nivel', value: lrStr, inline: false }
            );
        return interaction.editReply({ embeds: [embed] });
    }

    if (sub === 'level-rol') {
        const roleId = interaction.options.getRole('rol').id;
        const xp = interaction.options.getInteger('xp');
        await getDB().run('INSERT INTO level_roles (guild_id, role_id, xp_required) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET xp_required = excluded.xp_required', [guildId, roleId, xp]);
        return interaction.editReply(`Configurado: <@&${roleId}> a ${xp} XP.`);
    }

    const fieldMap = {
        'welcome': ['welcome_channel_id', interaction.options.getChannel('channel')?.id],
        'exit': ['exit_channel_id', interaction.options.getChannel('channel')?.id],
        'levels': ['levels_channel_id', interaction.options.getChannel('channel')?.id],
        'logs': ['logs_channel_id', interaction.options.getChannel('channel')?.id],
        'ticket': ['ticket_channel_id', interaction.options.getChannel('channel')?.id],
        'ticket-category': ['ticket_category_id', interaction.options.getString('id')],
        'ticket-staff': ['ticket_staff_roles', interaction.options.getRole('rol')?.id],
        'autorole': ['autorole_id', interaction.options.getRole('rol')?.id],
        'music': ['music_channel_id', interaction.options.getChannel('channel')?.id],
    };

    const [field, value] = fieldMap[sub] || [];
    if (field && value) {
        await setConfig(guildId, field, value);
        return interaction.editReply(`**${sub}** actualizado.`);
    }
    return interaction.editReply('Error al procesar la configuración.');
}

// ─── Eventos ────────────────────────────────────────────────────────
client.on('guildMemberAdd', (m) => m.user.bot ? onNewBot(m) : handleMemberJoin(m));
client.on('guildMemberRemove', (m) => handleMemberRemove(m));
client.on('messageReactionAdd', async (r, u) => handleReaction(r, u, await getConfig(r.message.guildId)));

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    const isDM = message.channel.isDMBased();
    const guildConfig = isDM ? null : await getConfig(message.guild.id);

    try {
        if (!isDM && await handleTicketCreation(message)) return;
        if (await handleIA(message, globalConfig, guildConfig)) return;
        if (message.guild) {
            await handleLevelup(message, guildConfig);
            await handleModeration(message, guildConfig);
        }
    } catch (e) { console.error('Error mensaje:', e); }
});

// ─── Logs de Canales y Roles ────────────────────────────────────────
client.on('channelCreate', (c) => onChannelCreate(c));
client.on('channelDelete', (c) => onChannelDelete(c));
client.on('channelUpdate', (o, n) => onChannelUpdate(o, n));
client.on('roleCreate', (r) => onRoleCreate(r));
client.on('roleDelete', (r) => onRoleDelete(r));
client.on('roleUpdate', (o, n) => onRoleUpdate(o, n));
client.on('guildUpdate', (o, n) => onGuildUpdate(o, n));
client.on('guildBanAdd', (b) => onGuildBanAdd(b));
client.on('messageDelete', (m) => onMessageDelete(m));

(async () => {
    await initDB();
    client.login(process.env.BOT_TOKEN);
})();
