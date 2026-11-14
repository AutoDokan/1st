const { initAuthCreds, BufferJSON } = require('@whiskeysockets/baileys');
const { createClient } = require('@supabase/supabase-js');

function useSupabaseAuthState(supabaseUrl, supabaseKey, sessionId = 'default_session') {
  const supabase = createClient(supabaseUrl, supabaseKey);

  const init = async () => {
    // 1. Fetch credentials from Supabase
    let creds;
    const { data: credsRow, error: credsErr } = await supabase
      .from('whatsapp_sessions')
      .select('data')
      .eq('session_id', sessionId)
      .eq('key', 'creds')
      .single();

    if (credsErr || !credsRow) {
      creds = initAuthCreds();
    } else {
      creds = JSON.parse(JSON.stringify(credsRow.data), BufferJSON.reviver);
    }

    const saveCreds = async () => {
      const serialized = JSON.parse(JSON.stringify(creds, BufferJSON.replacer));
      await supabase
        .from('whatsapp_sessions')
        .upsert(
          {
            session_id: sessionId,
            key: 'creds',
            data: serialized,
            updated_at: new Date().toISOString()
          },
          { onConflict: 'session_id,key' }
        );
    };

    const state = {
      creds,
      keys: {
        get: async (type, ids) => {
          const keys = ids.map((id) => `${type}-${id}`);
          const { data, error } = await supabase
            .from('whatsapp_sessions')
            .select('key, data')
            .eq('session_id', sessionId)
            .in('key', keys);

          const result = {};
          if (!error && data) {
            data.forEach((row) => {
              const origId = row.key.replace(`${type}-`, '');
              result[origId] = JSON.parse(JSON.stringify(row.data), BufferJSON.reviver);
            });
          }
          return result;
        },
        set: async (data) => {
          const upsertRows = [];
          for (const category of Object.keys(data)) {
            for (const id of Object.keys(data[category])) {
              const val = data[category][id];
              const rowKey = `${category}-${id}`;
              if (val) {
                upsertRows.push({
                  session_id: sessionId,
                  key: rowKey,
                  data: JSON.parse(JSON.stringify(val, BufferJSON.replacer)),
                  updated_at: new Date().toISOString()
                });
              } else {
                await supabase
                  .from('whatsapp_sessions')
                  .delete()
                  .eq('session_id', sessionId)
                  .eq('key', rowKey);
              }
            }
          }

          if (upsertRows.length > 0) {
            await supabase
              .from('whatsapp_sessions')
              .upsert(upsertRows, { onConflict: 'session_id,key' });
          }
        }
      }
    };

    return { state, saveCreds };
  };

  return init();
}

module.exports = { useSupabaseAuthState };
