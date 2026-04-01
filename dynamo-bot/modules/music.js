import { EmbedBuilder } from 'discord.js';
import { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState, getVoiceConnection } from '@discordjs/voice';
import playdl from 'play-dl';

// ─── Estado global por servidor ──────────────────────────────────────
// Map<guildId, { connection, player, queue, volume, textChannelId, current }>
const players = new Map();

// ─── Helpers ─────────────────────────────────────────────────────────

function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function buildProgressBar(position, duration, length = 20) {
  if (!duration || duration === 0) return '▬'.repeat(length);
  const progress  = Math.min(Math.floor((position / duration) * length), length);
  const remaining = length - progress;
  return '▬'.repeat(Math.max(progress - 1, 0)) + '🔘' + '▬'.repeat(remaining);
}

function getState(guildId) {
  return players.get(guildId) ?? null;
}

function destroyState(guildId) {
  const state = players.get(guildId);
  if (!state) return;
  try { state.player?.stop(true); } catch (_) {}
  try { state.connection?.destroy(); } catch (_) {}
  players.delete(guildId);
}

async function playNext(guildId, client) {
  const state = getState(guildId);
  if (!state) return;

  if (state.queue.length === 0) {
    const ch = client.channels.cache.get(state.textChannelId);
    if (ch) {
      ch.send({
        embeds: [
          new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('✅ Cola finalizada')
            .setDescription('No hay más canciones en la cola. ¡Añade más con `/play`!')
        ]
      }).catch(() => {});
    }
    destroyState(guildId);
    return;
  }

  const track = state.queue.shift();
  state.current = track;

  try {
    const stream = await playdl.stream(track.url, { quality: 2 });
    const resource = createAudioResource(stream.stream, {
      inputType: stream.type,
      inlineVolume: true
    });
    resource.volume?.setVolume(state.volume / 100);
    state.resource = resource;
    state.player.play(resource);

    const ch = client.channels.cache.get(state.textChannelId);
    if (ch) {
      ch.send({
        embeds: [
          new EmbedBuilder()
            .setColor('#1DB954')
            .setTitle('🎶 Reproduciendo ahora')
            .setDescription(`**[${track.title}](${track.url})**`)
            .addFields(
              { name: '👤 Artista',  value: track.author   || 'Desconocido', inline: true },
              { name: '⏱️ Duración', value: formatDuration(track.durationSec), inline: true },
              { name: '🔊 Volumen',  value: `${state.volume}%`, inline: true }
            )
            .setThumbnail(track.thumbnail || null)
            .setFooter({ text: `Solicitado por ${track.requesterTag ?? 'Desconocido'}` })
            .setTimestamp()
        ]
      }).catch(() => {});
    }
  } catch (err) {
    console.error('[MUSIC] Error reproduciendo pista:', err);
    const ch = client.channels.cache.get(state.textChannelId);
    if (ch) {
      ch.send({
        embeds: [
          new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('❌ Error de reproducción')
            .setDescription(`No se pudo reproducir **${track.title}**.\nSaltando a la siguiente canción...`)
        ]
      }).catch(() => {});
    }
    playNext(guildId, client);
  }
}

// ─── Inicialización del Manager ──────────────────────────────────────

export async function initMusicManager(_client) {
  console.log('[MUSIC] Sistema de música simple inicializado (sin Lavalink).');
  return true;
}

// ─── Comandos ─────────────────────────────────────────────────────────

export async function handlePlay(interaction) {
  const voiceChannel = interaction.member?.voice?.channel;
  if (!voiceChannel) {
    return interaction.reply({ content: '❌ Debes estar en un canal de voz para usar este comando.', ephemeral: true });
  }

  await interaction.deferReply();

  const query   = interaction.options.getString('query');
  const guildId = interaction.guildId;
  const client  = interaction.client;

  try {
    // Buscar en YouTube
    let results;
    try {
      if (query.startsWith('http://') || query.startsWith('https://')) {
        results = await playdl.search(query, { limit: 1 });
        if (!results.length) {
          // Intentar como URL directa de playlist/video
          const info = await playdl.video_info(query).catch(() => null);
          if (info) results = [info.video_details];
        }
      } else {
        results = await playdl.search(query, { source: { youtube: 'video' }, limit: 5 });
      }
    } catch (searchErr) {
      console.error('[MUSIC] Error en búsqueda:', searchErr);
      results = [];
    }

    if (!results || results.length === 0) {
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor('#FEE75C')
            .setTitle('🔍 Sin resultados')
            .setDescription(`No se encontraron resultados para: **${query}**`)
        ]
      });
    }

    const video = results[0];
    const track = {
      title:       video.title  ?? 'Sin título',
      url:         video.url    ?? video.link ?? '',
      author:      video.channel?.name ?? video.music?.[0]?.artist ?? 'Desconocido',
      durationSec: video.durationInSec ?? 0,
      thumbnail:   video.thumbnails?.[0]?.url ?? null,
      requesterTag: interaction.user.tag
    };

    // Obtener o crear estado del servidor
    let state = getState(guildId);

    if (!state) {
      const connection = joinVoiceChannel({
        channelId:      voiceChannel.id,
        guildId:        guildId,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        selfDeaf:       true
      });

      const audioPlayer = createAudioPlayer();

      connection.subscribe(audioPlayer);

      // Esperar a que la conexión esté lista
      try {
        await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
      } catch {
        connection.destroy();
        return interaction.editReply({ content: '❌ No se pudo conectar al canal de voz. Inténtalo de nuevo.' });
      }

      state = {
        connection,
        player:        audioPlayer,
        queue:         [],
        volume:        80,
        current:       null,
        textChannelId: interaction.channelId,
        resource:      null
      };
      players.set(guildId, state);

      // Cuando termina una canción, reproducir la siguiente
      audioPlayer.on(AudioPlayerStatus.Idle, () => {
        playNext(guildId, client);
      });

      audioPlayer.on('error', err => {
        console.error('[MUSIC] AudioPlayer error:', err);
        playNext(guildId, client);
      });

      // Si la conexión se destruye externamente, limpiar estado
      connection.on(VoiceConnectionStatus.Destroyed, () => {
        players.delete(guildId);
      });
    }

    // Añadir a la cola
    state.queue.push(track);

    const isIdle = state.player.state.status === AudioPlayerStatus.Idle && !state.current;

    if (isIdle) {
      // Reproducir inmediatamente
      await playNext(guildId, client);
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor('#1DB954')
            .setTitle('🎶 Reproduciendo ahora')
            .setDescription(`**[${track.title}](${track.url})**`)
            .addFields(
              { name: '👤 Artista',  value: track.author, inline: true },
              { name: '⏱️ Duración', value: formatDuration(track.durationSec), inline: true }
            )
            .setThumbnail(track.thumbnail || null)
            .setFooter({ text: `Solicitado por ${interaction.user.tag}` })
        ]
      });
    }

    // Ya hay algo reproduciéndose — añadir a la cola
    return interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle('✅ Añadido a la cola')
          .setDescription(`**[${track.title}](${track.url})**`)
          .addFields(
            { name: '👤 Artista',       value: track.author, inline: true },
            { name: '⏱️ Duración',      value: formatDuration(track.durationSec), inline: true },
            { name: '📋 Posición cola', value: `${state.queue.length}`, inline: true }
          )
          .setThumbnail(track.thumbnail || null)
          .setFooter({ text: `Solicitado por ${interaction.user.tag}` })
      ]
    });

  } catch (error) {
    console.error('[PLAY ERROR]', error);
    return interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor('#ED4245')
          .setTitle('❌ Error inesperado')
          .setDescription('Ocurrió un error interno al procesar la música. Inténtalo de nuevo.')
      ]
    });
  }
}

export async function handlePause(interaction) {
  const state = getState(interaction.guildId);
  if (!state || !state.current) {
    return interaction.reply({ content: '❌ No hay música activa en este servidor.', ephemeral: true });
  }

  const status = state.player.state.status;

  if (status === AudioPlayerStatus.Paused) {
    state.player.unpause();
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor('#1DB954')
          .setTitle('▶️ Música reanudada')
          .setDescription(`Reanudando: **${state.current.title}**`)
      ]
    });
  }

  state.player.pause();
  return interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor('#FEE75C')
        .setTitle('⏸️ Música pausada')
        .setDescription(`Pausado: **${state.current.title}**\nUsa \`/pause\` de nuevo para reanudar.`)
    ]
  });
}

export async function handleSkip(interaction) {
  const state = getState(interaction.guildId);
  if (!state || !state.current) {
    return interaction.reply({ content: '❌ No hay música activa en este servidor.', ephemeral: true });
  }

  const current = state.current.title;
  const next    = state.queue[0]?.title;

  // Forzar Idle para que el listener dispare playNext
  state.player.stop();

  return interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('⏭️ Canción saltada')
        .setDescription(`Se saltó: **${current}**${next ? `\nSiguiente: **${next}**` : '\nNo hay más canciones en la cola.'}`)
    ]
  });
}

export async function handleStop(interaction) {
  const state = getState(interaction.guildId);
  if (!state) {
    return interaction.reply({ content: '❌ No estoy conectado a ningún canal de voz.', ephemeral: true });
  }

  destroyState(interaction.guildId);

  return interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor('#ED4245')
        .setTitle('⏹️ Reproducción detenida')
        .setDescription('Se limpió la cola y el bot se desconectó del canal de voz.')
    ]
  });
}

export async function handleQueue(interaction) {
  const state = getState(interaction.guildId);
  if (!state || (!state.current && state.queue.length === 0)) {
    return interaction.reply({ content: '❌ La cola está vacía.', ephemeral: true });
  }

  const current  = state.current;
  const upcoming = state.queue.slice(0, 10);
  const total    = state.queue.length;

  const embed = new EmbedBuilder()
    .setColor('#5865F2')
    .setTitle('📋 Cola de reproducción')
    .setTimestamp();

  if (current) {
    embed.addFields({
      name: '▶️ Reproduciendo ahora',
      value: `**[${current.title}](${current.url})**\n\`Duración: ${formatDuration(current.durationSec)}\``
    });
  }

  if (upcoming.length > 0) {
    const list = upcoming.map((t, i) =>
      `\`${i + 1}.\` **${t.title}** — \`${formatDuration(t.durationSec)}\``
    ).join('\n');
    embed.addFields({ name: `📜 Próximas canciones (${total} en total)`, value: list });
  }

  if (total > 10) {
    embed.setFooter({ text: `... y ${total - 10} canciones más en la cola` });
  }

  return interaction.reply({ embeds: [embed] });
}

export async function handleVolume(interaction) {
  const state = getState(interaction.guildId);
  if (!state || !state.current) {
    return interaction.reply({ content: '❌ No hay música activa en este servidor.', ephemeral: true });
  }

  const level = interaction.options.getInteger('level');
  state.volume = level;
  state.resource?.volume?.setVolume(level / 100);

  const bar   = '█'.repeat(Math.floor(level / 10)) + '░'.repeat(10 - Math.floor(level / 10));
  const emoji = level === 0 ? '🔇' : level < 30 ? '🔈' : level < 70 ? '🔉' : '🔊';

  return interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor('#1DB954')
        .setTitle(`${emoji} Volumen ajustado`)
        .setDescription(`\`[${bar}]\` **${level}%**`)
    ]
  });
}

export async function handleNowPlaying(interaction) {
  const state = getState(interaction.guildId);
  if (!state || !state.current) {
    return interaction.reply({ content: '❌ No hay ninguna canción reproduciéndose ahora mismo.', ephemeral: true });
  }

  const track = state.current;

  const embed = new EmbedBuilder()
    .setColor('#1DB954')
    .setTitle('🎶 Reproduciendo ahora')
    .setDescription(`**[${track.title}](${track.url})**`)
    .addFields(
      { name: '👤 Artista',  value: track.author || 'Desconocido', inline: true },
      { name: '⏱️ Duración', value: formatDuration(track.durationSec), inline: true },
      { name: '🔊 Volumen',  value: `${state.volume}%`, inline: true }
    )
    .setThumbnail(track.thumbnail || null)
    .setFooter({ text: `Solicitado por ${track.requesterTag ?? 'Desconocido'}` })
    .setTimestamp();

  return interaction.reply({ embeds: [embed] });
}
