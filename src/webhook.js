function buildPayload(url, data) {
  const isDiscord = url.includes('discord.com/api/webhooks') ||
                    url.includes('discordapp.com/api/webhooks');
  if (isDiscord) {
    const status = data.revealed ? '🔴 **Secret Revealed**' : '🟡 **Reveal Attempted** (already burned)';
    return {
      username:   'NullVault',
      embeds: [{
        title: status,
        color: data.revealed ? 0xef4444 : 0xf59e0b,
        fields: [
          { name: '🔗 Link',     value: data.publicUrl,                        inline: false },
          { name: '🌐 IP',       value: data.ip        || 'Unknown',           inline: true  },
          { name: '📍 Location', value: data.location  || '—',                 inline: true  },
          { name: '💻 Agent',    value: (data.userAgent|| '—').slice(0, 100),  inline: false },
          { name: '↩️ Referer',  value: (data.referer  || '—').slice(0, 100),  inline: false },
        ],
        footer:    { text: 'NullVault Honeypot' },
        timestamp: new Date().toISOString(),
      }],
    };
  }
  return {
    event:     data.revealed ? 'secret_revealed' : 'reveal_attempted',
    publicUrl: data.publicUrl,
    ip:        data.ip,
    location:  data.location,
    userAgent: data.userAgent,
    referer:   data.referer,
    timestamp: new Date().toISOString(),
  };
}

async function fireWebhook(webhookUrl, data) {
  if (!webhookUrl) return;
  const payload = buildPayload(webhookUrl, data);
  try {
    const res = await fetch(webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
      signal:  AbortSignal.timeout(8000),
    });
    if (!res.ok) console.warn(`[Webhook] HTTP ${res.status} from ${webhookUrl}`);
    else         console.log(`[Webhook] Fired to ${webhookUrl}`);
  } catch (err) {
    console.warn(`[Webhook] Error: ${err.message}`);
  }
}

module.exports = { fireWebhook };
