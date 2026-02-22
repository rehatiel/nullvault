function buildPayload(url, data) {
  const isDiscord = url.includes('discord.com/api/webhooks') ||
                    url.includes('discordapp.com/api/webhooks');

  if (isDiscord) {
    let title, color;
    if (data.event === 'first_access') {
      title = '👁️ **First Access Detected**';
      color = 0x58a6ff;
    } else if (data.revealed) {
      title = '🔴 **Secret Revealed**';
      color = 0xef4444;
    } else if (data.test) {
      title = '🟢 **Test Ping**';
      color = 0x3fb950;
    } else {
      title = '🟡 **Reveal Attempted** (already burned)';
      color = 0xf59e0b;
    }
    return {
      username: 'NullVault',
      embeds: [{
        title,
        color,
        fields: [
          { name: '🔗 Link',     value: data.publicUrl,                       inline: false },
          { name: '🌐 IP',       value: data.ip        || 'Unknown',          inline: true  },
          { name: '📍 Location', value: data.location  || '—',                inline: true  },
          { name: '💻 Agent',    value: (data.userAgent|| '—').slice(0, 100), inline: false },
          { name: '↩️ Referer',  value: (data.referer  || '—').slice(0, 100), inline: false },
        ],
        footer:    { text: 'NullVault Honeypot' },
        timestamp: new Date().toISOString(),
      }],
    };
  }

  // Generic JSON
  return {
    event:     data.event || (data.revealed ? 'secret_revealed' : data.test ? 'test_ping' : 'reveal_attempted'),
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
    else         console.log(`[Webhook] Fired to ${webhookUrl} (event: ${data.event || 'reveal'})`);
  } catch (err) {
    console.warn(`[Webhook] Error: ${err.message}`);
  }
}

module.exports = { fireWebhook };
