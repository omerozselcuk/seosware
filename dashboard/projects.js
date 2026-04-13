let projects = [];
let activeProjectId = null;
let historyList = [];

function icon(name, cls = '') {
  return `<span class="icon ${cls}" aria-hidden="true">${name}</span>`;
}

// Navigation Views
function showView(id) {
  document.getElementById('view-list').style.display = 'none';
  document.getElementById('view-form').style.display = 'none';
  document.getElementById('view-project').style.display = 'none';
  document.getElementById(id).style.display = 'block';
}

function showForm() {
  document.getElementById('pName').value = '';
  document.getElementById('pUrls').value = '';
  showView('view-form');
}

// Data fetching
async function loadProjects() {
  try {
    const res = await fetch('/api/projects');
    projects = await res.json();
    
    const grid = document.getElementById('projectsGrid');
    if (projects.length === 0) {
      grid.innerHTML = `<div class="surface-panel" style="text-align:center; color:var(--text-muted); padding:48px 24px;"><div style="display:flex; justify-content:center; margin-bottom:12px;">${icon('inventory_2', 'icon-xl')}</div><p>Henüz proje yok.</p></div>`;
    } else {
      grid.innerHTML = projects.map(p => `
        <div class="card" onclick="openProject('${p.id}')">
          <div class="card-head">
            <div>
              <h3>${p.name}</h3>
              <p>${(p.urls||[]).length} URL yönetiliyor</p>
            </div>
            <span class="icon-chip">${icon('folder_open')}</span>
          </div>
          <div class="card-meta">
            <span class="pill">${icon('link', 'icon-sm')}${(p.urls||[]).length} URL</span>
            <span class="pill">${icon('schedule', 'icon-sm')}Son Güncelleme: ${new Date(p.updatedAt).toLocaleDateString()}</span>
          </div>
        </div>
      `).join('');
    }
    showView('view-list');
  } catch (e) {
    console.error(e);
  }
}

async function saveProject() {
  const name = document.getElementById('pName').value.trim();
  const rawUrls = document.getElementById('pUrls').value;
  const urls = rawUrls.split('\n').map(u=>u.trim()).filter(u=>u.length>0);
  
  if (!name || urls.length===0) return alert('İsim ve en az 1 URL girmelisiniz!');

  try {
    await fetch('/api/projects', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ name, urls })
    });
    loadProjects();
  } catch(e) { console.error(e); }
}

async function openProject(id) {
  activeProjectId = id;
  const p = projects.find(x => x.id === id);
  if(!p) return;
  
  document.getElementById('activeProjectName').textContent = p.name;
  document.getElementById('activeProjectUrlsCount').textContent = `${(p.urls||[]).length} URL yönetiliyor`;
  
  showView('view-project');
  loadHistory(id);
}

async function deleteActiveProject() {
  if(!confirm("Bu proje ve tüm tarihçesi silinecek. Emin misiniz?")) return;
  await fetch(`/api/projects/${activeProjectId}`, { method:'DELETE' });
  loadProjects();
}

// History & Delta
async function loadHistory(id) {
  const tbody = document.getElementById('historyBody');
  tbody.innerHTML = '<tr><td colspan="3" style="color:var(--text-muted)">Yükleniyor...</td></tr>';
  document.getElementById('deltaResults').innerHTML = '';
  
  try {
    const res = await fetch(`/api/projects/${id}/history`);
    historyList = await res.json();
    
    if(historyList.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="color:var(--text-muted)">Hiç geçmiş tarama yok.</td></tr>';
    } else {
      tbody.innerHTML = historyList.map(h => `
        <tr>
          <td><input type="checkbox" class="hist-check" value="${h.id}"></td>
          <td>${new Date(h.timestamp).toLocaleString()}</td>
          <td>${h.totalUrls} Sayfa</td>
          <td>
            <div class="action-buttons">
              <button class="btn btn-primary btn-icon-only" style="font-size: 11px;" title="Görüntüle" onclick="viewHistory('${activeProjectId}', '${h.id}')">${icon('visibility', 'icon-sm')}</button>
              <button class="btn btn-outline" style="padding: 8px 12px; font-size: 11px;" title="AI Analiz" onclick="openAiInsight('${h.id}')">${icon('auto_awesome', 'icon-sm')}AI</button>
              <button class="btn btn-outline" style="padding: 8px 12px; font-size: 11px; border-color:var(--accent); color:var(--accent);" title="JSON İndir" onclick="downloadHistoryJson('${activeProjectId}', '${h.id}', '${h.timestamp}')">${icon('download', 'icon-sm')}JSON</button>
            </div>
          </td>
        </tr>
      `).join('');
    }
  } catch (e) {}
}

function viewHistory(pId, hId) {
  window.location.href = `index.html?pId=${pId}&hId=${hId}`;
}

async function downloadHistoryJson(pId, hId, timestamp) {
  try {
    const res = await fetch(`/api/projects/${pId}/history/${hId}`);
    const data = await res.json();
    if (!data || !data.results) return alert('Veri bulunamadı.');
    
    // AI insight verisini de isteyip istemediğini sordum ama varsayılan olarak sonuçları indiriyoruz
    const blob = new Blob([JSON.stringify(data.results, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    
    const dateStr = new Date(data.timestamp || Number(timestamp)).toISOString().split('.')[0].replace(/[:T]/g, '-');
    a.download = `seosware-project-audit-${dateStr}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error(e);
    alert('İndirme sırasında hata oluştu.');
  }
}

async function compareSelected() {
  const checkboxes = Array.from(document.querySelectorAll('.hist-check:checked'));
  if(checkboxes.length !== 2) {
    return alert('Kıyaslama (Delta) yapmak için tam olarak 2 geçmiş raporu seçmelisiniz.');
  }
  
  const idA = checkboxes[1].value; // older
  const idB = checkboxes[0].value; // newer
  
  const container = document.getElementById('deltaResults');
  container.innerHTML = 'Kıyaslanıyor...';
  
  try {
    const res = await fetch(`/api/projects/${activeProjectId}/delta?runA=${idA}&runB=${idB}`);
    const deltas = await res.json();
    
    if(deltas.length === 0) {
      container.innerHTML = '<p>Hiç URL kalmamış?</p>';
      return;
    }
    
    // Sadece değişenleri filtrele
    const changed = deltas.filter(d => d.status !== 'unchanged');
    
    if(changed.length === 0) {
      container.innerHTML = `<div class="delta-item improvement"><div style="display:flex; align-items:center; gap:10px;">${icon('check_circle', 'icon-sm')}Seçilen iki tarama arasında sıfır fark var. Her şey aynı.</div></div>`;
      return;
    }
    
    container.innerHTML = changed.map(d => {
      let cls = 'info';
      if(d.status === 'new') cls = 'improvement';
      else if(d.status === 'dropped') cls = 'warning';
      else if(d.severity === 'critical') cls = 'critical';
      else if(d.severity === 'warning') cls = 'warning';
      else cls = 'improvement';
      
      const changesHtml = d.changes.length > 0 
        ? d.changes.map(c => {
            if(typeof c === 'string') return `<div class="change-row">${c}</div>`;
            const colorClass = c.danger ? 'change-bad' : 'change-good';
            return `<div class="change-row">
              <span>${c.label}</span>
              <span class="${colorClass}">${c.from} ➔ ${c.to}</span>
            </div>`;
          }).join('')
        : '';

      return `
        <div class="delta-item ${cls}">
          <div class="section-head" style="margin-bottom:8px;"><b>${d.url}</b><span class="pill">${icon(cls === 'critical' ? 'warning' : cls === 'warning' ? 'error' : 'trending_up', 'icon-sm')}${d.status}</span></div>
          <div style="margin-top:8px;">${changesHtml}</div>
        </div>
      `;
    }).join('');
    
  } catch(e) {
    container.innerHTML = 'Hata oluştu.';
    console.error(e);
  }
}

// Trigger Run
async function runProject() {
  const btn = document.getElementById('runProjectBtn');
  const statusBox = document.getElementById('runStatus');
  const progBox = document.getElementById('runProgress');
  const logBox = document.getElementById('runLog');
  
  btn.disabled = true;
  statusBox.style.display = 'block';
  progBox.style.width = '0%';
  logBox.textContent = 'Başlatılıyor...';
  
  const eventSource = new EventSource('/api/events');
  
  eventSource.addEventListener('progress', e => {
    const d = JSON.parse(e.data);
    const pct = Math.round((d.current / d.total) * 100);
    progBox.style.width = pct + '%';
  });
  
  eventSource.addEventListener('log', e => {
    const d = JSON.parse(e.data);
    logBox.textContent = d.message;
  });
  
  eventSource.addEventListener('completed', e => {
    eventSource.close();
    btn.disabled = false;
    statusBox.style.display = 'none';
    alert('Tarama tamamlandı! Geçmiş listesi yenileniyor.');
    loadHistory(activeProjectId);
  });
  
  try {
    await fetch(`/api/projects/${activeProjectId}/run`, { method: 'POST' });
  } catch(e) {
    btn.disabled = false;
  }
}

// ─── AI INSIGHTS ───
const aiInsightCache = {}; // Cache by runId

async function openAiInsight(runId) {
  const modal = document.getElementById('aiModal');
  const loading = document.getElementById('aiLoading');
  const reportBox = document.getElementById('aiReportBox');
  
  modal.classList.add('open');

  // If we have a cached report for this runId, show it instantly
  if (aiInsightCache[runId]) {
    loading.style.display = 'none';
    reportBox.innerHTML = aiInsightCache[runId];
    document.querySelectorAll('.pdf-btn').forEach(btn => btn.style.display = 'block');
    return;
  }

  loading.style.display = 'block';
  reportBox.innerHTML = '';
  
  try {
    const res = await fetch(`/api/projects/${activeProjectId}/history/${runId}/insight`, {
      method: 'POST'
    });
    const data = await res.json();
    
    loading.style.display = 'none';
    if (data.error) {
      reportBox.innerHTML = `<div style="color:var(--red); padding:20px; border:1px solid var(--red); border-radius:8px;">
        <h3 style="display:flex; align-items:center; gap:8px;">${icon('warning', 'icon-sm')}Hata</h3>
        <p>${data.error}</p>
      </div>`;
    } else {
      aiInsightCache[runId] = data.html; // Cache the report
      reportBox.innerHTML = data.html;
      document.querySelectorAll('.pdf-btn').forEach(btn => btn.style.display = 'block');
    }
  } catch (e) {
    loading.style.display = 'none';
    reportBox.innerHTML = 'Bir hata oluştu.';
  }
}

function closeAiModal() {
  document.getElementById('aiModal').classList.remove('open');
  document.querySelectorAll('.pdf-btn').forEach(btn => btn.style.display = 'none');
}

function downloadAiReportAsPdf() {
  const element = document.getElementById('aiReportBox');
  const projectName = document.getElementById('activeProjectName').innerText || 'Proje';
  const dateStr = new Date().toISOString().split('T')[0];
  const filename = `Seosware-AI-Raporu-${projectName}-${dateStr}.pdf`.replace(/\s+/g, '-');

  // Inject temporary print-mode styles that override dark theme
  const printStyle = document.createElement('style');
  printStyle.id = 'pdfPrintMode';
  printStyle.textContent = `
    #aiReportBox, #aiReportBox *,
    #aiReportBox *::before, #aiReportBox *::after {
      color: #334155 !important;
      background: transparent !important;
      background-color: transparent !important;
    }
    #aiReportBox { background: #ffffff !important; padding: 24px 32px !important; }
    #aiReportBox h1, #aiReportBox h2 { color: #0f172a !important; font-size: 17px !important; border-bottom: 2px solid #cbd5e1 !important; padding-bottom: 6px !important; }
    #aiReportBox h3, #aiReportBox h4, #aiReportBox h5 { color: #1e293b !important; font-size: 14px !important; }
    #aiReportBox p { color: #334155 !important; }
    #aiReportBox strong, #aiReportBox b { color: #0f172a !important; }
    #aiReportBox a { color: #2563eb !important; }
    #aiReportBox table { border: 1px solid #d1d5db !important; background: #ffffff !important; }
    #aiReportBox th { background: #f1f5f9 !important; color: #0f172a !important; border-bottom: 2px solid #d1d5db !important; }
    #aiReportBox td { color: #334155 !important; border-bottom: 1px solid #e5e7eb !important; background: #ffffff !important; }
    #aiReportBox tr { background: #ffffff !important; }
    #aiReportBox thead, #aiReportBox thead tr { background: #f1f5f9 !important; }
    #aiReportBox li { color: #334155 !important; }
    #aiReportBox code, #aiReportBox pre { color: #be185d !important; background: #fef2f2 !important; }
    #aiReportBox blockquote { color: #475569 !important; background: #f8fafc !important; border-left: 3px solid #6366f1 !important; }
    #aiReportBox em, #aiReportBox i { color: #475569 !important; }
    #aiReportBox span, #aiReportBox div { color: #334155 !important; }
  `;
  document.head.appendChild(printStyle);

  html2pdf().set({
    margin: [10, 10, 10, 10],
    filename: filename,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  }).from(element).save().then(() => {
    document.getElementById('pdfPrintMode')?.remove();
  });
}

// Init
window.onload = loadProjects;
