/**
 * dashboard-info.js — Session info overlay with live stats, process table, and output.
 */

/* global ServerManager */

const DashboardInfo = (() => {
  let infoInterval = null;
  let _esc = null;

  function init(deps) {
    _esc = deps.esc;
    document.getElementById('info-close').addEventListener('click', close);
  }

  function open(sessionName, serverName) {
    document.getElementById('info-session-name').textContent = sessionName;
    document.getElementById('session-info-overlay').classList.remove('hidden');
    document.getElementById('info-body').innerHTML = '<div style="padding:20px;color:var(--text-muted);font-family:var(--mono);font-size:12px;">Loading\u2026</div>';
    fetchData(sessionName, serverName);
    infoInterval = setInterval(() => fetchData(sessionName, serverName), 2000);
  }

  function close() {
    document.getElementById('session-info-overlay').classList.add('hidden');
    if (infoInterval) { clearInterval(infoInterval); infoInterval = null; }
  }

  async function fetchData(sessionName, serverName) {
    try {
      const origin = serverName ? ServerManager.getOrigin(serverName) : '';
      const res = await fetch(`${origin}/api/sessions/${encodeURIComponent(sessionName)}/info`);
      if (!res.ok) throw new Error('Session not found');
      render(await res.json());
    } catch (err) {
      document.getElementById('info-body').innerHTML =
        `<div style="padding:20px;color:var(--danger);font-family:var(--mono);font-size:12px;">${_esc(err.message)}</div>`;
      close();
    }
  }

  function render(d) {
    const now = Math.floor(Date.now() / 1000);
    const uptime = fmtDur(now - d.created);
    const idle = fmtDur(now - d.lastActivity);
    const createdStr = new Date(d.created * 1000).toLocaleString();
    const mem = fmtMem(d.totalMemory);

    let html = `<div class="info-stats">
      <div class="info-stat"><div class="info-stat-label">Uptime</div><div class="info-stat-value accent">${uptime}</div></div>
      <div class="info-stat"><div class="info-stat-label">Last Active</div><div class="info-stat-value">${idle} ago</div></div>
      <div class="info-stat"><div class="info-stat-label">Memory</div><div class="info-stat-value blue">${mem}</div></div>
      <div class="info-stat"><div class="info-stat-label">CPU</div><div class="info-stat-value orange">${d.totalCpu.toFixed(1)}%</div></div>
      <div class="info-stat"><div class="info-stat-label">Processes</div><div class="info-stat-value">${d.processCount}</div></div>
      <div class="info-stat"><div class="info-stat-label">Windows</div><div class="info-stat-value">${d.windows}</div></div>
      <div class="info-stat"><div class="info-stat-label">Clients</div><div class="info-stat-value">${d.attached}</div></div>
      <div class="info-stat"><div class="info-stat-label">Created</div><div class="info-stat-value" style="font-size:11px">${createdStr}</div></div>
    </div>`;

    html += '<div class="info-section-title">Processes</div>';
    html += '<table class="info-procs"><thead><tr><th>PID</th><th>Command</th><th>Mem</th><th>CPU</th><th>CWD</th></tr></thead><tbody>';
    for (const pane of d.panes) {
      for (const proc of pane.processes) {
        const cwdShort = pane.cwd.replace(/^\/home\/[^/]+/, '~');
        html += `<tr><td>${proc.pid}</td><td class="proc-cmd">${_esc(proc.command)}</td><td class="proc-mem">${fmtMem(proc.rss)}</td><td>${proc.cpu.toFixed(1)}%</td><td>${_esc(cwdShort)}</td></tr>`;
      }
    }
    html += '</tbody></table>';

    if (d.panes.length > 0) {
      html += '<div class="info-section-title">Panes</div><div class="info-stats">';
      for (const pane of d.panes) {
        html += `<div class="info-stat"><div class="info-stat-label">Win ${pane.window} / Pane ${pane.index}</div><div class="info-stat-value" style="font-size:12px">${pane.width}x${pane.height}</div></div>`;
      }
      html += '</div>';
    }

    if (d.recentOutput.length > 0) {
      html += '<div class="info-section-title" style="margin-top:16px">Recent Output</div>';
      html += `<div class="info-output">${_esc(d.recentOutput.join('\n').trimEnd())}</div>`;
    }

    document.getElementById('info-body').innerHTML = html;
  }

  function fmtDur(seconds) {
    if (seconds < 0) seconds = 0;
    const d = Math.floor(seconds / 86400), h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  function fmtMem(kb) {
    if (kb >= 1048576) return (kb / 1048576).toFixed(1) + ' GB';
    if (kb >= 1024) return (kb / 1024).toFixed(1) + ' MB';
    return kb + ' kB';
  }

  return { init, open, close };
})();
