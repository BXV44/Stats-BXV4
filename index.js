const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');

const TOKEN = process.env.TOKEN;
if (!TOKEN) { console.error("❌ TOKEN manquant"); process.exit(1); }

const DB_FILE = './stats.json';
function loadDB() {
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, '{}');
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}
function saveDB(data) { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); }

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildPresences],
});

const commands = [
  new SlashCommandBuilder().setName('stats-setup').setDescription('Créer les salons de statistiques 📊')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o => o.setName('catégorie').setDescription('Catégorie où créer les salons (optionnel)')),

  new SlashCommandBuilder().setName('stats-remove').setDescription('Supprimer les salons de statistiques 🗑️')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder().setName('stats-info').setDescription('Voir les statistiques du serveur 📈'),

  new SlashCommandBuilder().setName('cmd').setDescription('Liste des commandes 📋'),
];

// ── Mise à jour des stats ────────────────────────────────────
async function updateStats(guild) {
  const db = loadDB();
  const guildData = db[guild.id];
  if (!guildData) return;

  await guild.members.fetch();

  const total     = guild.memberCount;
  const bots      = guild.members.cache.filter(m => m.user.bot).size;
  const humans    = total - bots;
  const boosts    = guild.premiumSubscriptionCount || 0;
  const channels  = guild.channels.cache.size;
  const roles     = guild.roles.cache.size;

  const stats = [
    { key: 'total',    label: `👥 Membres : ${total}` },
    { key: 'humans',   label: `🙋 Humains : ${humans}` },
    { key: 'bots',     label: `🤖 Bots : ${bots}` },
    { key: 'boosts',   label: `🚀 Boosts : ${boosts}` },
    { key: 'channels', label: `📢 Salons : ${channels}` },
    { key: 'roles',    label: `🎭 Rôles : ${roles}` },
  ];

  for (const stat of stats) {
    const chId = guildData[stat.key];
    if (!chId) continue;
    const ch = guild.channels.cache.get(chId);
    if (ch && ch.name !== stat.label) {
      await ch.setName(stat.label).catch(() => {});
    }
  }

  console.log(`[STATS] ${guild.name} mis à jour`);
}

// ── Setup ────────────────────────────────────────────────────
async function setupStats(guild, categoryId = null) {
  const db = loadDB();
  if (db[guild.id]) return null; // déjà configuré

  const statsDefs = [
    { key: 'total',    name: '👥 Membres : ...' },
    { key: 'humans',   name: '🙋 Humains : ...' },
    { key: 'bots',     name: '🤖 Bots : ...' },
    { key: 'boosts',   name: '🚀 Boosts : ...' },
    { key: 'channels', name: '📢 Salons : ...' },
    { key: 'roles',    name: '🎭 Rôles : ...' },
  ];

  db[guild.id] = {};

  // Créer la catégorie si pas fournie
  let catId = categoryId;
  if (!catId) {
    const cat = await guild.channels.create({
      name: '📊 ─ Statistiques',
      type: ChannelType.GuildCategory,
    });
    catId = cat.id;
    db[guild.id].category = catId;
  }

  for (const def of statsDefs) {
    const ch = await guild.channels.create({
      name: def.name,
      type: ChannelType.GuildVoice,
      parent: catId,
      permissionOverwrites: [
        { id: guild.roles.everyone, deny: [PermissionFlagsBits.Connect] },
        { id: client.user.id, allow: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.Connect] },
      ],
    });
    db[guild.id][def.key] = ch.id;
    await new Promise(r => setTimeout(r, 500)); // éviter le rate limit
  }

  saveDB(db);
  await updateStats(guild);
  return true;
}

client.once('ready', async () => {
  console.log(`✅ ${client.user.tag} connecté`);
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands.map(c => c.toJSON()) });
  console.log('✅ Slash commands enregistrées');
  client.user.setActivity('📊 Stats', { type: 3 });

  // Mise à jour toutes les 10 minutes
  setInterval(async () => {
    for (const guild of client.guilds.cache.values()) {
      await updateStats(guild).catch(() => {});
    }
  }, 10 * 60 * 1000);

  // Première mise à jour au démarrage
  setTimeout(async () => {
    for (const guild of client.guilds.cache.values()) {
      await updateStats(guild).catch(() => {});
    }
  }, 5000);
});

// Events pour mise à jour rapide
client.on('guildMemberAdd', async (member) => { await updateStats(member.guild).catch(() => {}); });
client.on('guildMemberRemove', async (member) => { await updateStats(member.guild).catch(() => {}); });

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName, options, guild } = interaction;

  try {
    // SETUP
    if (commandName === 'stats-setup') {
      const db = loadDB();
      if (db[guild.id]) return interaction.reply({ content: '❌ Stats déjà configurées. Utilise `/stats-remove` d\'abord.', ephemeral: true });
      await interaction.deferReply({ ephemeral: true });
      const catChannel = options.getChannel('catégorie');
      await setupStats(guild, catChannel?.id || null);
      return interaction.editReply({ content: '✅ Salons de stats créés et mis à jour !' });
    }

    // REMOVE
    if (commandName === 'stats-remove') {
      const db = loadDB();
      const guildData = db[guild.id];
      if (!guildData) return interaction.reply({ content: '❌ Aucune stat configurée.', ephemeral: true });
      await interaction.deferReply({ ephemeral: true });

      const keys = ['total', 'humans', 'bots', 'boosts', 'channels', 'roles', 'category'];
      for (const key of keys) {
        if (guildData[key]) {
          const ch = guild.channels.cache.get(guildData[key]);
          if (ch) await ch.delete().catch(() => {});
        }
      }
      delete db[guild.id];
      saveDB(db);
      return interaction.editReply({ content: '✅ Salons de stats supprimés.' });
    }

    // INFO
    if (commandName === 'stats-info') {
      await guild.members.fetch();
      const total    = guild.memberCount;
      const bots     = guild.members.cache.filter(m => m.user.bot).size;
      const humans   = total - bots;
      const boosts   = guild.premiumSubscriptionCount || 0;
      const channels = guild.channels.cache.size;
      const roles    = guild.roles.cache.size;

      const embed = new EmbedBuilder()
        .setColor(0x5865f2).setTitle(`📊 Statistiques — ${guild.name}`)
        .setThumbnail(guild.iconURL())
        .addFields(
          { name: '👥 Membres total', value: `**${total}**`, inline: true },
          { name: '🙋 Humains',       value: `**${humans}**`, inline: true },
          { name: '🤖 Bots',          value: `**${bots}**`, inline: true },
          { name: '🚀 Boosts',        value: `**${boosts}**`, inline: true },
          { name: '📢 Salons',        value: `**${channels}**`, inline: true },
          { name: '🎭 Rôles',         value: `**${roles}**`, inline: true },
          { name: '📅 Créé le',       value: `<t:${Math.floor(guild.createdTimestamp/1000)}:D>`, inline: true },
          { name: '👑 Propriétaire',  value: `<@${guild.ownerId}>`, inline: true },
        ).setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }

    // CMD
    if (commandName === 'cmd') {
      const embed = new EmbedBuilder().setColor(0x5865f2).setTitle('📊 Commandes — Stats')
        .setDescription('/stats-setup — Créer les salons de stats\n/stats-remove — Supprimer les salons\n/stats-info — Voir les stats du serveur\n/cmd — Cette liste')
        .setFooter({ text: 'Les stats se mettent à jour toutes les 10 minutes' });
      return interaction.reply({ embeds: [embed] });
    }

  } catch (err) {
    console.error(err);
    if (!interaction.replied && !interaction.deferred)
      interaction.reply({ content: `❌ Erreur : ${err.message}`, ephemeral: true });
  }
});

process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);
client.login(TOKEN);
