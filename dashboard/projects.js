let projects = [];
let activeProjectId = null;
let historyList = [];

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
      grid.innerHTML = '<p style="color:var(--text-muted)">Henüz proje yok.</p>';
    } else {
      grid.innerHTML = projects.map(p => `
        <div class="card" onclick="openProject('${p.id}')">
          <h3>${p.name}</h3>
          <p>${(p.urls||[]).length} URL yönetiliyor</p>
          <p style="font-size:11px; opacity:0.6;">Son Güncelleme: ${new Date(p.updatedAt).toLocaleDateString()}</p>
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
  tbody.innerHTML = '<tr><td colspan="3">Yükleniyor...</td></tr>';
  document.getElementById('deltaResults').innerHTML = '';
  
  try {
    const res = await fetch(`/api/projects/${id}/history`);
    historyList = await res.json();
    
    if(historyList.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3">Hiç geçmiş tarama yok.</td></tr>';
    } else {
      tbody.innerHTML = historyList.map(h => `
        <tr>
          <td><input type="checkbox" class="hist-check" value="${h.id}"></td>
          <td>${new Date(h.timestamp).toLocaleString()}</td>
          <td>${h.totalUrls} Sayfa</td>
        </tr>
      `).join('');
    }
  } catch (e) {}
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
      container.innerHTML = '<div class="delta-item improvement">✅ Seçilen iki tarama arasında sıfır fark var. Her şey aynı.</div>';
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
          <b>${d.url}</b>
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

// Init
window.onload = loadProjects;
