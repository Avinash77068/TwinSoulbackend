const axios = require('axios');
const CryptoJS = require('crypto-js');

const endpoints = {
  search_base_url: 'https://www.jiosaavn.com/api.php?__call=autocomplete.get&_format=json&_marker=0&cc=in&includeMetaTags=1&query=',
  song_details_base_url: 'https://www.jiosaavn.com/api.php?__call=song.getDetails&cc=in&_marker=0%3F_marker%3D0&_format=json&pids=',
  album_details_base_url: 'https://www.jiosaavn.com/api.php?__call=content.getAlbumDetails&_format=json&cc=in&_marker=0%3F_marker%3D0&albumid=',
  playlist_details_base_url: 'https://www.jiosaavn.com/api.php?__call=playlist.getDetails&_format=json&cc=in&_marker=0%3F_marker%3D0&listid=',
  lyrics_base_url: 'https://www.jiosaavn.com/api.php?__call=lyrics.getLyrics&ctx=web6dot0&api_version=4&_format=json&_marker=0%3F_marker%3D0&lyrics_id=',
};

function decryptMediaUrl(encrypted) {
  try {
    const key = CryptoJS.enc.Utf8.parse('38346591');
    const ciphertext = CryptoJS.enc.Base64.parse(encrypted);
    const decrypted = CryptoJS.DES.decrypt({ ciphertext }, key, {
      mode: CryptoJS.mode.ECB,
      padding: CryptoJS.pad.Pkcs7,
    });
    let url = decrypted.toString(CryptoJS.enc.Utf8);
    // Upgrade to 320kbps if available
    url = url.replace('_96.mp4', '_320.mp4').replace('_160.mp4', '_320.mp4');
    return url || null;
  } catch {
    return null;
  }
}

function decodeUnicodeEscape(str) {
  return str.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
}

async function searchSongs(query) {
  try {
    
    const response = await axios.get(endpoints.search_base_url + query, { responseType: 'text' });
    let text = decodeUnicodeEscape(response.data);
    text = text.replace(/\(From "([^"]+)"\)/g, "(From '$1')");
    const parsed = JSON.parse(text);
    const songs = parsed.songs?.data || [];

    

    return {
      success: true,
      data: songs.map(song => ({
        id: song.id,
        title: song.title,
        artist: song.more_info?.primary_artists || song.more_info?.singers || song.artist_name,
        image: song.image,
        album: song.album,
        duration: song.more_info?.duration || song.duration,
      })),
    };
  } catch (error) {
    console.error(`[JioSaavn] Search error:`, error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

async function getSongDetails(id) {
  try {

    const response = await axios.get(endpoints.song_details_base_url + id, { responseType: 'text' });
    const text = decodeUnicodeEscape(response.data);
    const parsed = JSON.parse(text);
    const songData = parsed[id];

    if (!songData) {
      return { success: false, error: 'Song not found' };
    }

    const streamUrl = decryptMediaUrl(songData.encrypted_media_url);

    return {
      success: true,
      data: {
        id: songData.id,
        title: songData.song || songData.title,
        artist: songData.primary_artists,
        album: songData.album,
        duration: songData.duration,
        image: songData.image,
        url: songData.perma_url || songData.permaurl,
        downloadUrl: streamUrl,
      },
    };
  } catch (error) {
    console.error(`[JioSaavn] Get song details error:`, error.message);
    return { success: false, error: error.message };
  }
}

async function getLyrics(songId) {
  try {

    const response = await axios.get(endpoints.lyrics_base_url + songId);
    return {
      success: true,
      lyrics: response.data.lyrics || 'Lyrics not available',
    };
  } catch (error) {
    console.error(`[JioSaavn] Get lyrics error:`, error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

module.exports = {
  searchSongs,
  getSongDetails,
  getLyrics,
};
