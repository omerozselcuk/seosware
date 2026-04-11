const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');
const HISTORY_DIR = path.join(DATA_DIR, 'history');

// Ensure directories exist
async function initStorage() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.mkdir(HISTORY_DIR, { recursive: true });
    try {
      await fs.access(PROJECTS_FILE);
    } catch {
      await fs.writeFile(PROJECTS_FILE, JSON.stringify([]));
    }
  } catch (err) {
    console.error("[Storage] Failed to initialize:", err);
  }
}

async function getProjects() {
  try {
    const data = await fs.readFile(PROJECTS_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function getProject(id) {
  const projects = await getProjects();
  return projects.find(p => p.id === id) || null;
}

async function saveProject(projectInput) {
  const projects = await getProjects();
  let project = projects.find(p => p.id === projectInput.id);
  
  if (project) {
    // Update
    Object.assign(project, projectInput);
    project.updatedAt = new Date().toISOString();
  } else {
    // Create new
    project = {
      id: crypto.randomBytes(6).toString('hex'),
      name: projectInput.name || 'Yeni Proje',
      urls: projectInput.urls || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    projects.push(project);
    
    // Create history dir
    await fs.mkdir(path.join(HISTORY_DIR, project.id), { recursive: true });
  }

  await fs.writeFile(PROJECTS_FILE, JSON.stringify(projects, null, 2));
  return project;
}

async function deleteProject(id) {
  const projects = await getProjects();
  const filtered = projects.filter(p => p.id !== id);
  if (filtered.length !== projects.length) {
    await fs.writeFile(PROJECTS_FILE, JSON.stringify(filtered, null, 2));
    try {
      await fs.rm(path.join(HISTORY_DIR, id), { recursive: true, force: true });
    } catch(e) {}
    return true;
  }
  return false;
}

async function saveHistory(projectId, results) {
  const timestamp = new Date().toISOString();
  const filename = timestamp.replace(/[:.]/g, '-') + '.json';
  const filePath = path.join(HISTORY_DIR, projectId, filename);
  
  const historyData = {
    id: filename.replace('.json', ''),
    projectId,
    timestamp,
    totalUrls: Array.isArray(results) ? results.length : 1,
    results
  };

  // Ensure project dir exists
  await fs.mkdir(path.join(HISTORY_DIR, projectId), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(historyData, null, 2));
  return historyData;
}

async function getHistoryList(projectId) {
  const projectDir = path.join(HISTORY_DIR, projectId);
  try {
    const files = await fs.readdir(projectDir);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    
    // Read only meta stuff to keep it lightweight, not the giant result arrays
    let list = [];
    for (const f of jsonFiles) {
      const p = path.join(projectDir, f);
      const data = JSON.parse(await fs.readFile(p, 'utf8'));
      list.push({
        id: data.id,
        timestamp: data.timestamp,
        totalUrls: data.totalUrls
      });
    }
    return list.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
  } catch {
    return [];
  }
}

async function getHistoryItem(projectId, historyId) {
  const filePath = path.join(HISTORY_DIR, projectId, `${historyId}.json`);
  try {
    const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
    return data;
  } catch {
    return null;
  }
}

// Call init directly on load
initStorage();

module.exports = {
  getProjects,
  getProject,
  saveProject,
  deleteProject,
  saveHistory,
  getHistoryList,
  getHistoryItem
};
