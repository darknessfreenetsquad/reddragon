const APIs = {
    xteam: process.env.XTEAM_API_URL || 'https://api.xteam.xyz',
    dzx: process.env.DZX_API_URL || 'https://api.dhamzxploit.my.id',
    lol: process.env.LOLHUMAN_API_URL || 'https://api.lolhuman.xyz',
    violetics: process.env.VIOLETICS_API_URL || 'https://violetics.pw',
    neoxr: process.env.NEOXR_API_URL || 'https://api.neoxr.my.id',
    zenzapis: process.env.ZENZAPIS_API_URL || 'https://zenzapis.xyz',
    akuari: process.env.AKUARI_API_URL || 'https://api.akuari.my.id',
    akuari2: process.env.AKUARI2_API_URL || 'https://apimu.my.id',
    nrtm: process.env.NRTM_API_URL || 'https://fg-nrtm.ddns.net',
    bg: process.env.BG_API_URL || 'http://bochil.ddns.net',
    fgmods: process.env.FGMODS_API_URL || 'https://api-fgmods.ddns.net'
};

const APIKeys = {
    xteam: process.env.XTEAM_API_KEY || '',
    lol: process.env.LOLHUMAN_API_KEY || '',
    neoxr: process.env.NEOXR_API_KEY || '',
    violetics: process.env.VIOLETICS_API_KEY || '',
    zenzapis: process.env.ZENZAPIS_API_KEY || '',
    fgmods: process.env.FGMODS_API_KEY || ''
};

module.exports = {
    AUTO_VIEW_STATUS: 'true',
    AUTO_LIKE_STATUS: 'true',
    AUTO_RECORDING: 'false',
    AUTO_LIKE_EMOJI: ['❤️', '💗', '🔥', '🥰'],
    PREFIX: '.',
    MAX_RETRIES: 3,
    GROUP_INVITE_LINK: '',
    OTP_EXPIRY: 300000,
    BOT_NAME: 'Red Mini',
    OWNER_NAME: 'Red Dragon',
    BOT_VERSION: '1.0.0',
    BOT_FOOTER: '© ʀᴇᴅ ᴅʀᴀɢᴏɴ ᴅғs',
    IMAGE_THEME: 'Redragon',
    CHANNEL_LINK: '',
    NEWSLETTER_JID: '120363427119111004@newsletter',
    RCD_IMAGE_PATH: 'https://files.catbox.moe/eumprt.jpg',
    APIs,
    APIKeys
};
