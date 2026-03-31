import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState
} from '@discordjs/voice';
import play from 'play-dl';

const queues = new Map();

function getQueue(guildId) {
  if (!queues.has(guildId)) {
    queues.set(guildId, {
      songs: [],
      player: null,
      connection: null,
      playing: false
    });
  }
  return queues.get(guildId);
}

async function playSong(queue, guildId) {
  if (!queue.songs.length) {
    queue.playing = false;
    if (queue.connection) {
      try {
        queue.connection.destroy();
      } catch (e) {}
    }
    queue.connection = null;
    queues.delete(guildId); // Limpiar memoria
    return;
  }

  const song = queue.songs[0];
  queue.playing = true;

  try {
    console.log(`[MUSIC] Reproduciendo: ${song.title}`);
    
    // play-dl necesita refrescar tokens a veces
    if (play.is_expired()) await play.getFreeToken();

    const stream = await play.stream(song.url, { 
      quality: 2,
      discordPlayerCompatibility: true 
    });
    
    if (!stream || !stream.stream) {
      throw new Error('Stream no disponible');
    }

    const resource = createAudioResource(stream.stream, { 
      inputType: stream.type,
      inlineVolume: true
    });

    resource.volume.setVolume(0.5);
    queue.player.play(resource);

  } catch (error) {
    console.error(`[MUSIC ERROR] Error en ${song.title}:`, error.message);
    queue.songs.shift();
    await playSong(queue, guildId);
  }
}

export async function handlePlay(interaction) {
  const voiceChannel = interaction.member.voice.channel;
  if (!voiceChannel) {
    return interaction.reply({ content: 'Debes estar en un canal de voz.', ephemeral: true });
  }

  await interaction.deferReply();

  const query = interaction.options.getString('query');
  const guildId = interaction.guildId;
  const queue = getQueue(guildId);

  try {
    let songInfo;
    const validation = await play.validate(query);

    if (validation === 'video' || query.includes('youtu')) {
      const info = await play.video_info(query);
      songInfo = {
        title: info.video_details.title,
        url: info.video_details.url,
        duration: info.video_details.durationRaw
      };
    } else {
      const results = await play.search(query, { limit: 1 });
      if (!results.length) return interaction.editReply('No se encontraron resultados.');
      songInfo = {
        title: results[0].title,
        url: results[0].url,
        duration: results[0].durationRaw
      };
    }

    queue.songs.push(songInfo);

    if (!queue.player) {
      queue.player = createAudioPlayer();
      queue.player.on(AudioPlayerStatus.Idle, () => {
        queue.songs.shift();
        playSong(queue, guildId);
      });
      queue.player.on('error', (error) => {
        console.error(`[PLAYER ERROR]`, error.message);
        queue.songs.shift();
        playSong(queue, guildId);
      });
    }

    if (!queue.connection) {
      queue.connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId,
        adapterCreator: interaction.guild.voiceAdapterCreator,
      });

      queue.connection.subscribe(queue.player);

      try {
        await entersState(queue.connection, VoiceConnectionStatus.Ready, 20_000);
      } catch (error) {
        queue.connection.destroy();
        queue.connection = null;
        return interaction.editReply('Error al conectar al canal de voz.');
      }
    }

    if (queue.player.state.status !== AudioPlayerStatus.Playing) {
      await playSong(queue, guildId);
      await interaction.editReply(`🎶 Reproduciendo: **${songInfo.title}**`);
    } else {
      await interaction.editReply(`✅ En cola: **${songInfo.title}**`);
    }

  } catch (error) {
    console.error(`[PLAY ERROR]`, error);
    await interaction.editReply('Hubo un error al procesar la canción.');
  }
}

export async function handlePause(interaction) {
  const queue = queues.get(interaction.guildId);
  if (!queue?.player) return interaction.reply({ content: 'No hay música.', ephemeral: true });

  if (queue.player.state.status === AudioPlayerStatus.Playing) {
    queue.player.pause();
    await interaction.reply('⏸️ Pausado.');
  } else {
    queue.player.unpause();
    await interaction.reply('▶️ Reanudado.');
  }
}

export async function handleSkip(interaction) {
  const queue = queues.get(interaction.guildId);
  if (!queue || queue.songs.length === 0) {
    return interaction.reply({ content: 'Nada que saltar.', ephemeral: true });
  }

  // Al detener el player, el evento 'Idle' se activa automáticamente y pasa a la siguiente
  queue.player.stop();
  await interaction.reply('⏭️ Saltando canción...');
}

export async function handleStop(interaction) {
  const queue = queues.get(interaction.guildId);
  if (!queue) return interaction.reply({ content: 'No estoy en un canal.', ephemeral: true });

  queue.songs = [];
  queue.player?.stop(true);
  queue.connection?.destroy();
  queues.delete(interaction.guildId);

  await interaction.reply('⏹️ Detenido y lista limpiada.');
}

export async function handleQueue(interaction) {
  const queue = queues.get(interaction.guildId);
  if (!queue || !queue.songs.length) return interaction.reply('La cola está vacía.');

  const list = queue.songs.slice(0, 10).map((s, i) =>
    `${i === 0 ? '▶️' : `${i}.`} **${s.title}** \`[${s.duration}]\``
  ).join('\n');

  await interaction.reply(`📖 **Cola actual:**\n${list}${queue.songs.length > 10 ? `\n... y ${queue.songs.length - 10} más` : ''}`);
}
