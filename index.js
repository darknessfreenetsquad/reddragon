const express = require('express');
const fs = require('fs');
const path = require('path');

// Keep transient media away from a potentially quota-limited system /tmp.
const customTemp = path.join(process.cwd(), 'temp');
fs.mkdirSync(customTemp, { recursive: true });
process.env.TMPDIR = customTemp;
process.env.TEMP = customTemp;
process.env.TMP = customTemp;

const TEMP_MAX_AGE_MS = 3 * 60 * 60 * 1000;
const tempCleanupTimer = setInterval(() => {
    fs.readdir(customTemp, (readError, files) => {
        if (readError) return;
        for (const file of files) {
            const filePath = path.join(customTemp, file);
            fs.stat(filePath, (statError, stats) => {
                if (!statError && stats.isFile() && Date.now() - stats.mtimeMs > TEMP_MAX_AGE_MS) {
                    fs.unlink(filePath, () => {});
                }
            });
        }
    });
}, TEMP_MAX_AGE_MS);
tempCleanupTimer.unref();

const app = express();
const PORT = process.env.PORT || 8002;
const DASHBOARD_ONLY = process.env.RED_DASHBOARD_ONLY === '1';
const defaultConfig = require('./config');
const code = require('./pair');
const { loadPlugins } = require('./plugin-loader');
const { listImageThemes, getActiveImageTheme } = require('./lib/image-themes');

const COMMAND_GROUPS = [
    { name: 'Downloaders', icon: '⬇️', commands: ['download', 'movie', 'movies', 'fb', 'facebook', 'instagram', 'ig', 'tiktok', 'tt', 'twitter', 'tw', 'ytdl', 'ytvideo', 'ytaudio'] },
    { name: 'Music & Audio', icon: '🎵', commands: ['play', 'music', 'audius', 'soundcloud', 'jamendo', 'spotify', 'applemusic', 'songsearch', 'findsong', 'trending', 'audiomacktrending', 'ceenaija'] },
    { name: 'Anime', icon: '🎬', commands: ['anime', 'crunchyroll'] },
    { name: 'Tools', icon: '🔧', commands: ['weather', 'google', 'translate', 'calc', 'short', 'jid', 'sticker', 'pair', 'converctor', 'converter', 'to-url', 'to-doc', 'to-music', 'to-sticker', 'tgstickers', 'update'] },
    { name: 'Fun & Games', icon: '😄', commands: ['truth', 'dare', 'rps'] },
    { name: 'Group', icon: '👥', commands: ['kick', 'kickall', 'mute', 'open', 'adddescription', 'addstgroup', 'addstchannel'] },
    { name: 'Bot Info', icon: '📊', commands: ['alive', 'ping', 'profile', 'stats', 'setting', 'imagetheme', 'setimage', 'statusview'] },
    { name: 'Owner', icon: '👑', commands: ['broadcast', 'admin', 'newsletter', 'deleteme'] }
];

app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));
app.use(express.urlencoded({ extended: false, limit: '16kb' }));
if (DASHBOARD_ONLY) {
    // Viewing the dashboard must never create or restore a WhatsApp session.
    app.use('/code', (req, res, next) => {
        res.status(503).json({
            error: 'WhatsApp lifecycle is disabled in dashboard-only mode',
            dashboardOnly: true
        });
    });
}
app.use('/code', code);

app.get('/status', (req, res) => res.sendFile(path.join(__dirname, 'status.html')));
app.get('/pair', (req, res) => res.sendFile(path.join(__dirname, 'main.html')));

app.get('/api/status', async (req, res) => {
    const sessions = code.getActiveSessions();
    const database = await code.checkDatabase();
    res.set('Cache-Control', 'no-store').json({
        status: 'online',
        botName: process.env.BOT_NAME || 'Red Mini',
        ownerNumber: /^\d{10,15}$/.test(process.env.OWNER_NUMBER || defaultConfig.OWNER_NUMBER || '')
            ? (process.env.OWNER_NUMBER || defaultConfig.OWNER_NUMBER)
            : null,
        newsletter: process.env.NEWSLETTER_JID || '120363427119111004@newsletter',
        uptime: process.uptime(),
        activeSessions: sessions.length,
        // Do not expose complete phone numbers on the public status endpoint.
        sessions: sessions.map(number => '*'.repeat(Math.max(0, number.length - 4)) + number.slice(-4)),
        database,
        timestamp: new Date().toISOString()
    });
});

app.get('/api/catalog', (req, res) => {
    const plugins = loadPlugins();
    const available = new Set(plugins.keys());
    available.delete('musicaudio');
    available.delete('musicdoc');
    const groups = COMMAND_GROUPS.map(group => ({
        name: group.name,
        icon: group.icon,
        commands: group.commands.filter(command => available.has(command))
    })).filter(group => group.commands.length);
    const assigned = new Set(groups.flatMap(group => group.commands));
    const remaining = [...available].filter(command => command !== 'menu' && !assigned.has(command)).sort();
    if (remaining.length) groups.push({ name: 'Other loaded commands', icon: '🧩', commands: remaining });

    res.set('Cache-Control', 'no-store').json({
        activeTheme: getActiveImageTheme()?.name || 'Redragon',
        themes: listImageThemes().map(name => {
            const theme = require('./lib/image-themes').getImageTheme(name);
            return { name, menu: theme.menu, ping: theme.ping, welcome: theme.welcome };
        }),
        groups,
        pluginCount: new Set(plugins.values()).size,
        commandCount: [...available].filter(command => command !== 'menu').length
    });
});

app.get('/', (req, res) => res.redirect('/status'));

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Red Mini listening on port ${PORT}`);
        if (process.env.RED_DASHBOARD_ONLY !== '1') {
            code.startSavedSessions().catch(err => console.error('Could not restore sessions:', err.message));
        } else {
            console.log('Dashboard-only mode: WhatsApp session restoration disabled.');
        }
    });
}

module.exports = app;
