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
    return;
  }

  const song = queue.songs[0];
  queue.playing = true;

  try {
    console.log(`[MUSIC] Reproduciendo: ${song.title}`);
    
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

    queue.player.play(resource);
    console.log(`[MUSIC] Reproduciendo correctamente: ${song.title}`);

  } catch (error) {
    console.error(`[MUSIC ERROR] Error reproduciendo ${song.title}:`, error.message);
    queue.songs.shift();
    await playSong(queue, guildId);
  }
}

export async function handlePlay(interaction) {
  const voiceChannel = interaction.member.voice.channel;
  if (!voiceChannel) {
    return interaction.reply({ 
      content: 'Debes estar en un canal de voz.', 
      ephemeral: true 
    });
  }

  await interaction.deferReply();

  const query = interaction.options.getString('query');
  const guildId = interaction.guildId;

  try {
    console.log(`[MUSIC] Buscando: ${query}`);

    let songInfo;
    const validated = play.yt_validate(query);

    if (validated === 'video') {
      console.log(`[MUSIC] URL de video detectada`);
      const info = await play.video_info(query);
      songInfo = {
        title: info.video_details.title,
        url: query,
        duration: info.video_details.durationRaw
      };
    } else {
      console.log(`[MUSIC] Buscando en YouTube: ${query}`);
      const results = await play.search(query, { limit: 1 });
      
      if (!results.length) {
        return interaction.editReply('No se encontraron resultados.');
      }

      songInfo = {
        title: results[0].title,
        url: results[0].url,
        duration: results[0].durationRaw
      };
    }

    console.log(`[MUSIC] Cancion encontrada: ${songInfo.title}`);

    const queue = getQueue(guildId);
    queue.songs.push(songInfo);

    // Crear player si no existe
    if (!queue.player) {
      queue.player = createAudioPlayer();

      queue.player.on(AudioPlayerStatus.Idle, () => {
        console.log(`[MUSIC] Cancion terminada, siguiente...`);
        queue.songs.shift();
        playSong(queue, guildId);
      });

      queue.player.on('error', (error) => {
        console.error(`[MUSIC] Player error:`, error.message);
        queue.songs.shift();
        playSong(queue, guildId);
      });
    }

    // Conectar al canal de voz si no está conectado
    if (!queue.connection) {
      console.log(`[MUSIC] Conectando al canal de voz...`);
      
      queue.connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId,
        adapterCreator: interaction.guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false
      });

      queue.connection.subscribe(queue.player);

      // Esperar a que la conexión esté lista
      try {
        await entersState(queue.connection, VoiceConnectionStatus.Ready, 30_000);
        console.log(`[MUSIC] Conectado al canal de voz`);
      } catch (error) {
        console.error(`[MUSIC] Error conectando:`, error.message);
        queue.connection.destroy();
        queue.connection = null;
        return interaction.editReply('No se pudo conectar al canal de voz. Intenta de nuevo.');
      }

      // Manejar desconexiones
      queue.connection.on(VoiceConnectionStatus.Disconnected, () => {
        console.log(`[MUSIC] Desconectado del canal de voz`);
        queue.connection = null;
        queue.playing = false;
      });
    }

    // Reproducir si no hay nada sonando
    if (!queue.playing) {
      await playSong(queue, guildId);
      await interaction.editReply(`Reproduciendo: ${songInfo.title} (${songInfo.duration})`);
    } else {
      await interaction.editReply(`Añadido a la cola: ${songInfo.title} (${songInfo.duration})`);
    }

  } catch (error) {
    console.error(`[MUSIC] Error en play:`, error.message);
    await interaction.editReply('Error al reproducir. Verifica la URL o intenta con otro termino.');
  }
}

export async function handlePause(interaction) {
  const queue = queues.get(interaction.guildId);
  if (!queue?.player) {
    return interaction.reply({ 
      content: 'No hay musica reproduciendose.', 
      ephemeral: true 
    });
  }

  if (queue.player.state.status === AudioPlayerStatus.Playing) {
    queue.player.pause();
    await interaction.reply('Musica pausada.');
  } else {
    queue.player.unpause();
    await interaction.reply('Musica reanudada.');
  }
}

export async function handleSkip(interaction) {
  const queue = queues.get(interaction.guildId);
  if (!queue?.songs.length) {
    return interaction.reply({ 
      content: 'No hay canciones en la cola.', 
      ephemeral: true 
    });
  }

  queue.songs.shift();

  if (queue.songs.length) {
    await playSong(queue, interaction.guildId);
    await interaction.reply(`Saltando. Ahora: ${queue.songs[0].title}`);
  } else {
    queue.player?.stop();
    if (queue.connection) {
      try {
        queue.connection.destroy();
      } catch (e) {}
    }
    queue.connection = null;
    queue.playing = false;
    await interaction.reply('Cola vacia. Desconectando.');
  }
}

export async function handleStop(interaction) {
  const queue = queues.get(interaction.guildId);
  if (!queue?.connection) {
    return interaction.reply({ 
      content: 'El bot no esta en un canal de voz.', 
      ephemeral: true 
    });
  }

  queue.songs = [];
  queue.player?.stop();
  
  try {
    queue.connection.destroy();
  } catch (e) {}
  
  queue.connection = null;
  queue.playing = false;
  queues.delete(interaction.guildId);

  await interaction.reply('Musica detenida.');
}

export async function handleQueue(interaction) {
  const queue = queues.get(interaction.guildId);
  if (!queue?.songs.length) {
    return interaction.reply({ 
      content: 'La cola esta vacia.', 
      ephemeral: true 
    });
  }

  const list = queue.songs.slice(0, 10).map((s, i) =>
    `${i === 0 ? '[Reproduciendo]' : `${i + 1}.`} ${s.title} (${s.duration})`
  ).join('\n');

  const more = queue.songs.length > 10 ? `\n... y ${queue.songs.length - 10} mas` : '';

  await interaction.reply(`Cola de reproduccion:\n${list}${more}`);
}
