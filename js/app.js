/* ScopeTracker Pro — application logic (vanilla ES6+) */
'use strict';

(() => {
  /* =====================================================================
     1. Constants & helpers
     ===================================================================== */
  const PHASES = [
    { key: 'P1', short: 'Phase 1', name: 'Phase 1: Site Survey, Risk/Opportunity Analysis & BOM Estimation' },
    { key: 'P2', short: 'Phase 2', name: 'Phase 2: Wonderware SCADA Architecture, HMI Graphics, Alarms & Trends' },
    { key: 'P3', short: 'Phase 3', name: 'Phase 3: PLC Integration & Protocols (OPC DA/UA, Modbus TCP/RTU, Secure Networking)' },
    { key: 'P4', short: 'Phase 4', name: 'Phase 4: Custom Scripting, SQL Database Integration & Query Optimization' },
    { key: 'P5', short: 'Phase 5', name: 'Phase 5: QA Testing, HSE Compliance (Annexure-SCT-HR-001), Legal Paperwork & Client Training' }
  ];
  const ACTION_STATUS = ['Backlog', 'In Progress', 'Commissioning', 'Blocked', 'Completed'];
  const PRIORITY = ['Low', 'Medium', 'High', 'Critical'];
  const PROJECT_STATUS = ['Planning', 'Active', 'On Hold', 'Completed'];
  const BOM_STATUS = ['Specified', 'RFQ Sent', 'Ordered', 'Delivered', 'Installed'];
  const BOM_CATS = ['Software License', 'Server / Workstation', 'PLC / RTU', 'Network', 'Field Equipment', 'Panel & Power'];
  const ROLES = ['SCADA Engineer', 'PLC Engineer', 'Estimation Engineer', 'Commissioning Engineer', 'Project Manager'];
  const BLOCKER_STATUS = ['Open', 'Escalated', 'Resolved'];
  const SEVERITY = ['Low', 'Medium', 'High', 'Critical'];
  const DOC_STATUS = ['Not Started', 'Draft', 'In Review', 'Approved', 'Handed Over'];
  const DOC_TYPES = ['Design Specification', 'SCADA Configuration Manual', 'User Training Guide', 'Legal Handover Paperwork', 'QA / FAT-SAT Procedure', 'I/O & Tag Database'];
  const QA_CATS = [
    { key: 'FAT', label: 'FAT — Factory Acceptance Test' },
    { key: 'SAT', label: 'SAT — Site Acceptance Test' },
    { key: 'QHSE', label: 'QHSE — Annexure-SCT-HR-001' }
  ];
  const NOTE_CATS = ['SQL', 'OPC DA/UA', 'Modbus TCP/RTU', 'Networking', 'Wonderware / AVEVA', 'General'];
  const STORES = ['projects', 'actions', 'bom', 'team', 'hours', 'blockers', 'qhse', 'docs', 'notes'];
  const TITLES = {
    dashboard: 'Dashboard & Scope WBS',
    actions: 'Doable Actions & Schedule',
    bom: 'Equipment, BOM & Procurement',
    resources: 'Resources, Hours & Blockers',
    docs: 'Docs, SQL/OPC Logs & QHSE'
  };
  const LS_SNAP = 'scopetracker.snapshot.v1';
  const LS_PROJECT = 'scopetracker.currentProject';
  const LS_SEEDED = 'scopetracker.seeded';
  const LS_INSTALL_DISMISS = 'scopetracker.installDismissed';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const sum = (arr, fn) => arr.reduce((t, x) => t + (Number(fn(x)) || 0), 0);
  const pct = (n) => Math.max(0, Math.min(100, Math.round(n || 0)));
  const aed = (n) => 'AED ' + Math.round(Number(n) || 0).toLocaleString('en-US');
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = () => ymd(new Date());
  const addDays = (s, n) => { const d = new Date(`${s}T00:00:00`); d.setDate(d.getDate() + n); return ymd(d); };
  const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / 864e5);
  const fmtDate = (s) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
  const fmtShort = (s) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—');
  const phaseOf = (key) => PHASES.find((p) => p.key === key);
  const phaseShort = (key) => (phaseOf(key) ? phaseOf(key).short : 'Unphased');
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-');

  /* =====================================================================
     2. State & persistence (IndexedDB with localStorage mirror)
     ===================================================================== */
  const S = { projects: [], actions: [], bom: [], team: [], hours: [], blockers: [], qhse: [], docs: [], notes: [] };
  const UI = { view: 'dashboard', projectId: null, q: '', phase: '', assignee: '', status: '', layout: 'kanban', bomStatus: '', noteCat: '' };
  let db = null;

  class ScopeTrackerDB {
    constructor() { this.name = 'ScopeTrackerDB'; this.version = 1; this.idb = null; this.useLS = false; }

    open() {
      return new Promise((resolve) => {
        if (!('indexedDB' in window) || !window.indexedDB) { this.useLS = true; resolve(this); return; }
        let req;
        try { req = window.indexedDB.open(this.name, this.version); } catch (e) { this.useLS = true; resolve(this); return; }
        req.onupgradeneeded = () => {
          const d = req.result;
          STORES.forEach((s) => { if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' }); });
        };
        req.onsuccess = () => { this.idb = req.result; resolve(this); };
        req.onerror = () => { this.useLS = true; resolve(this); };
        req.onblocked = () => { this.useLS = true; resolve(this); };
      });
    }

    snapshot() {
      try {
        const raw = localStorage.getItem(LS_SNAP);
        return raw ? (JSON.parse(raw).data || null) : null;
      } catch (e) { return null; }
    }

    getAll(store) {
      if (this.useLS) { const s = this.snapshot(); return Promise.resolve((s && s[store]) || []); }
      return new Promise((resolve, reject) => {
        const r = this.idb.transaction(store, 'readonly').objectStore(store).getAll();
        r.onsuccess = () => resolve(r.result || []);
        r.onerror = () => reject(r.error);
      });
    }

    put(store, rec) {
      if (this.useLS) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const tx = this.idb.transaction(store, 'readwrite');
        tx.objectStore(store).put(rec);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }

    putMany(store, recs) {
      if (this.useLS || !recs.length) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const tx = this.idb.transaction(store, 'readwrite');
        const os = tx.objectStore(store);
        recs.forEach((r) => os.put(r));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }

    remove(store, id) {
      if (this.useLS) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const tx = this.idb.transaction(store, 'readwrite');
        tx.objectStore(store).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }

    clear(store) {
      if (this.useLS) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const tx = this.idb.transaction(store, 'readwrite');
        tx.objectStore(store).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }
  }

  function mirror() {
    try { localStorage.setItem(LS_SNAP, JSON.stringify({ savedAt: new Date().toISOString(), data: S })); } catch (e) { /* storage full or blocked */ }
  }

  async function save(store, rec) {
    const i = S[store].findIndex((r) => r.id === rec.id);
    if (i >= 0) S[store][i] = rec; else S[store].push(rec);
    try { await db.put(store, rec); } catch (e) { console.warn('IndexedDB write failed, using localStorage mirror', e); }
    mirror();
    return rec;
  }

  async function remove(store, id) {
    S[store] = S[store].filter((r) => r.id !== id);
    try { await db.remove(store, id); } catch (e) { console.warn(e); }
    mirror();
  }

  async function replaceAll(data) {
    for (const s of STORES) {
      S[s] = Array.isArray(data[s]) ? data[s] : [];
      try { await db.clear(s); await db.putMany(s, S[s]); } catch (e) { console.warn(e); }
    }
    mirror();
    try { localStorage.setItem(LS_SEEDED, '1'); } catch (e) { /* ignore */ }
  }

  async function loadAll() {
    for (const s of STORES) S[s] = await db.getAll(s);
    if (!S.projects.length) {
      const snap = db.snapshot();
      let seeded = false;
      try { seeded = localStorage.getItem(LS_SEEDED) === '1'; } catch (e) { /* ignore */ }
      if (snap && Array.isArray(snap.projects) && snap.projects.length) await replaceAll(snap);
      else if (!seeded) await replaceAll(buildSeed());
    } else {
      mirror();
    }
  }

  /* =====================================================================
     3. Templates & seed data
     ===================================================================== */
  const TEMPLATE = [
    {
      key: 'P1', from: 0, to: 0.15, lead: 'Estimation Engineer',
      title: 'Phase 1 — Site Survey, Risk/Opportunity Analysis & BOM Estimation',
      desc: 'Establish the as-found plant baseline, quantify risk and opportunity, and price the bill of materials.',
      kids: [
        ['Plant site survey & I/O walkdown', 24, 'Commissioning Engineer'],
        ['Risk & opportunity analysis (legacy PLCs, network, cybersecurity)', 12, 'SCADA Engineer'],
        ['BOM estimation & vendor quotations', 20, 'Estimation Engineer']
      ]
    },
    {
      key: 'P2', from: 0.12, to: 0.4, lead: 'SCADA Engineer',
      title: 'Phase 2 — Wonderware SCADA Architecture, HMI Graphics, Alarms & Trends',
      desc: 'Design the System Platform galaxy, build HMI graphics, and define the alarm and historian strategy.',
      kids: [
        ['System Platform Galaxy architecture & object templates', 40, 'SCADA Engineer'],
        ['HMI graphics — overview, equipment faceplates & navigation', 60, 'SCADA Engineer'],
        ['Alarm philosophy, priorities & historian trends', 36, 'SCADA Engineer']
      ]
    },
    {
      key: 'P3', from: 0.3, to: 0.65, lead: 'PLC Engineer',
      title: 'Phase 3 — PLC Integration & Protocols (OPC DA/UA, Modbus TCP/RTU, Secure Networking)',
      desc: 'Connect field controllers to the SCADA layer over secured, documented industrial protocols.',
      kids: [
        ['Modbus TCP/RTU register mapping & polling design', 32, 'PLC Engineer'],
        ['OPC DA/UA server configuration & secure endpoints', 24, 'SCADA Engineer'],
        ['Secure network segmentation & firewall rules', 16, 'PLC Engineer'],
        ['PLC–SCADA tag integration & I/O loop checks', 28, 'PLC Engineer']
      ]
    },
    {
      key: 'P4', from: 0.5, to: 0.8, lead: 'SCADA Engineer',
      title: 'Phase 4 — Custom Scripting, SQL Database Integration & Query Optimization',
      desc: 'Implement custom logic and reporting data flows, then tune queries for production load.',
      kids: [
        ['Custom QuickScript / .NET logic for sequencing & KPIs', 40, 'SCADA Engineer'],
        ['SQL database schema, stored procedures & report queries', 36, 'SCADA Engineer'],
        ['Query optimization, indexing & data retention jobs', 16, 'SCADA Engineer']
      ]
    },
    {
      key: 'P5', from: 0.75, to: 1, lead: 'Project Manager',
      title: 'Phase 5 — QA Testing, HSE Compliance (Annexure-SCT-HR-001), Legal Paperwork & Client Training',
      desc: 'Prove the system, close out QHSE obligations, complete handover paperwork and train the client.',
      kids: [
        ['FAT execution & punch-list closure', 24, 'Commissioning Engineer'],
        ['SAT & site commissioning', 48, 'Commissioning Engineer'],
        ['QHSE audit (Annexure-SCT-HR-001) & legal handover paperwork', 16, 'Project Manager'],
        ['Client operator & maintenance training', 16, 'SCADA Engineer']
      ]
    }
  ];

  function wbsTemplate(p, team) {
    const total = Math.max(daysBetween(p.start, p.deadline), 10);
    const pick = (role) => ((team.find((t) => t.role === role) || team[0] || {}).id) || '';
    const out = [];
    TEMPLATE.forEach((ph) => {
      const s = addDays(p.start, Math.round(total * ph.from));
      let e = addDays(p.start, Math.round(total * ph.to));
      if (e < s) e = s;
      const parentId = uid('act');
      out.push({
        id: parentId, projectId: p.id, parentId: '', phase: ph.key, title: ph.title, description: ph.desc,
        assigneeId: pick(ph.lead), priority: 'High', status: 'Backlog', progress: 0, start: s, end: e, estHours: 0
      });
      const span = Math.max(daysBetween(s, e), ph.kids.length);
      ph.kids.forEach((k, i) => {
        const cs = addDays(s, Math.floor((span * i) / ph.kids.length));
        let ce = i === ph.kids.length - 1 ? e : addDays(s, Math.floor((span * (i + 1)) / ph.kids.length));
        if (ce < cs) ce = cs;
        if (ce > e) ce = e;
        out.push({
          id: uid('act'), projectId: p.id, parentId, phase: ph.key, title: k[0], description: '',
          assigneeId: pick(k[2]), priority: i === 0 ? 'High' : 'Medium', status: 'Backlog', progress: 0,
          start: cs > e ? e : cs, end: ce, estHours: k[1]
        });
      });
    });
    return out;
  }

  function qaTemplate(pid) {
    const mk = (cat, text) => ({ id: uid('qa'), projectId: pid, category: cat, text, checked: false, ref: '' });
    return [
      mk('FAT', 'FAT procedure & test sheets approved by client'),
      mk('FAT', 'HMI graphics, navigation and faceplate behaviour verified'),
      mk('FAT', 'Alarm priorities, acknowledgement and suppression tested'),
      mk('FAT', 'Historian trends and data integrity verified'),
      mk('FAT', 'PLC tag mapping and I/O loop check completed'),
      mk('FAT', 'Redundancy / failover scenario tested'),
      mk('SAT', 'On-site OPC and Modbus communication test passed'),
      mk('SAT', 'Operator roles, security and audit trail verified'),
      mk('SAT', 'Backup and restore of Galaxy and SQL database verified'),
      mk('SAT', 'Client sign-off on SAT certificate obtained'),
      mk('QHSE', 'Site induction completed and permit-to-work obtained'),
      mk('QHSE', 'Risk assessment & method statement (RAMS) approved'),
      mk('QHSE', 'PPE verified for all site personnel'),
      mk('QHSE', 'Lock-out / tag-out procedure acknowledged for panel work'),
      mk('QHSE', 'Toolbox talk recorded before each site activity'),
      mk('QHSE', 'Incident / near-miss register updated'),
      mk('QHSE', 'Packaging and e-waste disposed of per environmental plan'),
      mk('QHSE', 'Annexure-SCT-HR-001 compliance signed off by QHSE officer')
    ].map((x) => (x.category === 'QHSE' ? Object.assign(x, { ref: 'Annexure-SCT-HR-001' }) : x));
  }

  function docTemplate(pid) {
    return DOC_TYPES.map((t) => ({
      id: uid('doc'), projectId: pid, type: t, title: t, status: 'Not Started', owner: '', due: '', rev: 'A', notes: ''
    }));
  }

  function buildSeed() {
    const t0 = today();
    const d = (n) => addDays(t0, n);
    const team = [
      { id: 'tm1', name: 'Omar Al Mansoori', role: 'SCADA Engineer', rate: 180, email: 'omar@example.ae' },
      { id: 'tm2', name: 'Priya Nair', role: 'PLC Engineer', rate: 165, email: 'priya@example.ae' },
      { id: 'tm3', name: 'Khalid Rahman', role: 'Estimation Engineer', rate: 150, email: 'khalid@example.ae' },
      { id: 'tm4', name: "Joseph D'Souza", role: 'Commissioning Engineer', rate: 170, email: 'joseph@example.ae' },
      { id: 'tm5', name: 'Sara Haddad', role: 'Project Manager', rate: 220, email: 'sara@example.ae' },
      { id: 'tm6', name: 'Ahmed Siddiqui', role: 'SCADA Engineer', rate: 140, email: 'ahmed@example.ae' }
    ];

    const p1 = {
      id: 'prj_dcp', name: 'Dubai District Cooling Plant — Wonderware System Platform & Modbus/OPC PLC Integration',
      client: 'Gulf Thermal Energy Services LLC', location: 'Business Bay, Dubai, U.A.E.', status: 'Active',
      objective: 'Deliver a redundant AVEVA/Wonderware System Platform SCADA for a 12,000 TR district cooling plant, integrating chillers, pumps, VFDs and energy meters over Modbus and OPC UA.',
      scope: 'In scope: Galaxy design, HMI graphics, alarms and historian, Modbus TCP/RTU and OPC UA integration, SQL reporting, FAT/SAT, client training. Out of scope: PLC code changes beyond register exposure, civil and mechanical works.',
      manager: 'Sara Haddad', start: d(-45), deadline: d(75), budget: 480000
    };
    const p2 = {
      id: 'prj_jaw', name: 'Jebel Ali Water Booster Station — AVEVA SCADA Upgrade',
      client: 'Al Marsa Water Utilities', location: 'Jebel Ali, Dubai, U.A.E.', status: 'Planning',
      objective: 'Migrate a legacy InTouch HMI to AVEVA System Platform with secure OPC UA connectivity to the existing PLC fleet.',
      scope: 'In scope: survey, migration of 600 tags, new HMI, historian, cybersecurity hardening, FAT/SAT. Out of scope: field instrumentation replacement.',
      manager: 'Sara Haddad', start: d(10), deadline: d(130), budget: 210000
    };

    const acts1 = wbsTemplate(p1, team);
    const kids1 = acts1.filter((a) => a.parentId);
    const prog = [
      [100, 'Completed'], [100, 'Completed'], [100, 'Completed'],
      [100, 'Completed'], [70, 'In Progress'], [55, 'In Progress'],
      [60, 'Commissioning'], [20, 'Blocked'], [10, 'Blocked'], [0, 'Backlog'],
      [0, 'Backlog'], [0, 'Backlog'], [0, 'Backlog'],
      [0, 'Backlog'], [0, 'Backlog'], [0, 'Backlog'], [0, 'Backlog']
    ];
    kids1.forEach((k, i) => { if (prog[i]) { k.progress = prog[i][0]; k.status = prog[i][1]; } });
    kids1[4].assigneeId = 'tm6';
    kids1[7].priority = 'Critical';
    kids1[8].priority = 'Critical';
    kids1[10].assigneeId = 'tm1';

    const acts2 = wbsTemplate(p2, team);
    const kids2 = acts2.filter((a) => a.parentId);
    kids2.slice(0, 2).forEach((k) => { k.status = 'In Progress'; k.progress = 15; });

    const hoursSpec = [
      ['tm4', 0, 44, 10, 'Chiller hall and pump room I/O walkdown'],
      ['tm4', 0, 43, 8, 'Switchgear room survey and panel photos'],
      ['tm1', 1, 42, 6, 'Legacy PLC and network risk register'],
      ['tm3', 2, 40, 12, 'Vendor RFQ package and comparison'],
      ['tm3', 2, 38, 9, 'BOM costing and lead-time review'],
      ['tm1', 3, 30, 22, 'Galaxy model, templates and deployment design'],
      ['tm1', 3, 26, 18, 'Object template inheritance and naming standard'],
      ['tm6', 4, 20, 20, 'HMI overview and chiller faceplates'],
      ['tm6', 4, 12, 16, 'Pump skid and VFD faceplates'],
      ['tm1', 5, 14, 14, 'Alarm classes and priority tuning'],
      ['tm2', 6, 15, 12, 'Modbus TCP register map for chillers'],
      ['tm2', 6, 8, 10, 'Polling groups and VFD register validation'],
      ['tm1', 7, 6, 8, 'OPC UA endpoint security policy and certificates'],
      ['tm2', 8, 5, 4, 'Firewall rule request drafting with client IT']
    ];
    const hours = hoursSpec.map((h) => ({
      id: uid('hr'), projectId: p1.id, actionId: kids1[h[1]].id, memberId: h[0], date: d(-h[2]), hours: h[3], note: h[4]
    }));

    const bom = [
      ['Software License', 'AVEVA System Platform Galaxy server license (runtime)', 1, 42000, 'Ordered', 'AVEVA via regional distributor', 21, 'Confirm redundant (secondary) engine licence is included in the quote.'],
      ['Software License', 'AVEVA Historian 5,000-tag license', 1, 28500, 'Ordered', 'AVEVA via regional distributor', 28, 'Survey counted ~4,200 historised tags; 5,000-tag tier leaves headroom.'],
      ['Software License', 'InTouch HMI client licences (operator stations)', 4, 6800, 'RFQ Sent', 'AVEVA via regional distributor', 21, ''],
      ['Server / Workstation', 'SCADA server — rack, redundant PSU, RAID 10', 2, 21500, 'Delivered', 'Dell Technologies (Dubai)', 14, 'Rack space confirmed in control room cabinet CR-02.'],
      ['Server / Workstation', 'Operator workstation with 27 in monitor', 3, 7800, 'Specified', 'Dell Technologies (Dubai)', 10, ''],
      ['Network', 'Managed industrial Ethernet switch, 24-port', 4, 5200, 'Delivered', 'Hirschmann (Belden)', 30, 'Opportunity: ring topology possible using existing fibre between plant rooms.'],
      ['Network', 'Industrial firewall / security appliance', 2, 9400, 'RFQ Sent', 'Fortinet reseller', 25, 'Required to isolate PLC network from the client BMS VLAN.'],
      ['Network', 'Modbus RTU/TCP serial gateway', 6, 1850, 'Ordered', 'Moxa distributor', 18, ''],
      ['PLC / RTU', 'Spare I/O modules for chiller PLC racks', 8, 3200, 'Specified', 'Schneider Electric', 35, 'Risk: legacy rack firmware may need update before spares are compatible.'],
      ['Panel & Power', 'UPS 3 kVA rack-mount', 2, 4600, 'Delivered', 'Eaton partner', 12, ''],
      ['Panel & Power', 'SCADA panel enclosure 800 x 2000 with cooling', 1, 18500, 'Delivered', 'Local panel builder', 28, ''],
      ['Field Equipment', 'Energy meters with Modbus RTU (field)', 12, 980, 'Specified', 'Schneider Electric', 21, 'Survey: chiller hall meters lack RS-485 termination — budget terminators and shielded cable.']
    ].map((b) => ({
      id: uid('bom'), projectId: p1.id, category: b[0], name: b[1], qty: b[2], unitCost: b[3], status: b[4], vendor: b[5], leadDays: b[6], notes: b[7]
    }));
    const bom2 = [
      ['Software License', 'AVEVA System Platform runtime (migration)', 1, 36000, 'Specified', 'AVEVA via regional distributor', 21, 'Legacy InTouch application needs migration assessment.'],
      ['Server / Workstation', 'Historian and application server', 1, 24500, 'Specified', 'Dell Technologies (Dubai)', 14, ''],
      ['Network', 'Industrial firewall pair', 2, 9400, 'Specified', 'Fortinet reseller', 25, '']
    ].map((b) => ({
      id: uid('bom'), projectId: p2.id, category: b[0], name: b[1], qty: b[2], unitCost: b[3], status: b[4], vendor: b[5], leadDays: b[6], notes: b[7]
    }));

    const blockers = [
      {
        id: uid('blk'), projectId: p1.id, title: 'Chiller OEM register map not released', severity: 'High', status: 'Escalated',
        description: 'OEM has supplied only a partial Modbus register list; alarm and status words for chillers 3 and 4 are missing.',
        impact: 'Blocks Modbus mapping and alarm configuration for two of four chillers.', ownerId: 'tm2',
        needed: 'PM to request the full register map and write permissions from the OEM account manager.',
        actionId: kids1[6].id, raised: d(-9), target: d(3), escalatedTo: 'Sara Haddad', escalatedAt: d(-7)
      },
      {
        id: uid('blk'), projectId: p1.id, title: 'OPC UA port 4840 firewall rule not approved', severity: 'Critical', status: 'Open',
        description: 'Client IT security board has not approved the OPC UA endpoint between the SCADA VLAN and PLC VLAN.',
        impact: 'Cannot complete secure OPC UA integration or begin end-to-end tag tests.', ownerId: 'tm1',
        needed: 'Client IT approval ticket; PM to attend security board on Thursday.',
        actionId: kids1[8].id, raised: d(-4), target: d(5), escalatedTo: '', escalatedAt: ''
      },
      {
        id: uid('blk'), projectId: p1.id, title: 'SQL Server edition mismatch on reporting server', severity: 'Medium', status: 'Open',
        description: 'Client-supplied SQL Server is Express edition; the Historian reporting design requires Standard for agent jobs.',
        impact: 'Data retention jobs and scheduled reports cannot run.', ownerId: 'tm6',
        needed: 'Client to supply Standard edition licence or approve our provided server.',
        actionId: '', raised: d(-2), target: d(14), escalatedTo: '', escalatedAt: ''
      },
      {
        id: uid('blk'), projectId: p1.id, title: 'Site access permit delayed for panel room', severity: 'Low', status: 'Resolved',
        description: 'Permit-to-work for MCC room delayed by two days.', impact: 'Survey slipped by two days.', ownerId: 'tm4',
        needed: 'None — resolved.', actionId: kids1[0].id, raised: d(-44), target: d(-42), escalatedTo: 'Sara Haddad', escalatedAt: d(-43)
      }
    ];

    const qa1 = qaTemplate(p1.id);
    [0, 1, 2, 10, 11, 12, 13].forEach((i) => { qa1[i].checked = true; });
    const qa2 = qaTemplate(p2.id);

    const docs1 = docTemplate(p1.id);
    const docStatus = ['Approved', 'Draft', 'Not Started', 'In Review', 'Approved', 'Draft'];
    docs1.forEach((x, i) => { x.status = docStatus[i]; x.owner = i === 3 ? 'Sara Haddad' : 'Omar Al Mansoori'; x.due = d(-20 + i * 18); });
    docs1[0].notes = 'Rev B issued after site survey; client comments closed.';
    const docs2 = docTemplate(p2.id);

    const notes = [
      {
        id: uid('note'), projectId: p1.id, category: 'Modbus TCP/RTU', title: 'Exception code 02 (Illegal Data Address) on chiller polling',
        body: 'Symptom: DAServer logs exception 02 for holding registers 40101-40140.\nCause: OEM map is 0-based, DAServer item is 1-based.\nFix: Offset all addresses by +1 in the device group, then re-validate against the OEM test sheet.',
        date: d(-15)
      },
      {
        id: uid('note'), projectId: p1.id, category: 'OPC DA/UA', title: 'OPC UA certificate trust failure',
        body: 'Symptom: BadCertificateUntrusted when the SCADA client connects to the PLC OPC UA server.\nFix: Move the client certificate from the rejected folder to the trusted folder of the server, and confirm the hostname in the SAN matches the connection URL.',
        date: d(-6)
      },
      {
        id: uid('note'), projectId: p1.id, category: 'SQL', title: 'Slow trend report — index on timestamp + tag',
        body: "Symptom: 24 h chiller report takes 40 s.\nFix: Add a covering index and filter on the clustered column first.\n\nCREATE NONCLUSTERED INDEX IX_Trend_Tag_Time\nON dbo.ChillerTrend (TagName, SampleTime)\nINCLUDE (Value, Quality);\n\nSELECT TagName, AVG(Value) AS AvgValue\nFROM dbo.ChillerTrend\nWHERE SampleTime >= DATEADD(hour, -24, GETDATE())\nGROUP BY TagName;",
        date: d(-3)
      }
    ];

    return {
      projects: [p1, p2],
      actions: acts1.concat(acts2),
      bom: bom.concat(bom2),
      team,
      hours,
      blockers,
      qhse: qa1.concat(qa2),
      docs: docs1.concat(docs2),
      notes
    };
  }

  /* =====================================================================
     4. Selectors & metrics
     ===================================================================== */
  const P = () => S.projects.find((p) => p.id === UI.projectId) || null;
  const member = (id) => S.team.find((t) => t.id === id) || null;
  const projActions = (pid = UI.projectId) => S.actions.filter((a) => a.projectId === pid);
  const kidsOf = (id) => S.actions.filter((a) => a.parentId === id);
  const hasKids = (id) => S.actions.some((a) => a.parentId === id);
  const leafActions = (pid = UI.projectId) => projActions(pid).filter((a) => !hasKids(a.id));

  function effProgress(a) {
    const ks = kidsOf(a.id);
    if (!ks.length) return pct(a.status === 'Completed' ? 100 : a.progress);
    const w = sum(ks, (k) => Math.max(k.estHours, 1));
    return pct(sum(ks, (k) => effProgress(k) * Math.max(k.estHours, 1)) / w);
  }

  function effStatus(a) {
    const ks = kidsOf(a.id);
    if (!ks.length) return a.status;
    const st = ks.map(effStatus);
    if (st.every((s) => s === 'Completed')) return 'Completed';
    if (st.some((s) => s === 'Blocked')) return 'Blocked';
    if (st.some((s) => s === 'Commissioning')) return 'Commissioning';
    if (st.some((s) => s === 'In Progress' || s === 'Completed')) return 'In Progress';
    return 'Backlog';
  }

  function actHours(a) {
    const ids = [a.id].concat(kidsOf(a.id).map((k) => k.id));
    const leaves = hasKids(a.id) ? kidsOf(a.id) : [a];
    return { est: sum(leaves, (x) => x.estHours), logged: sum(S.hours.filter((h) => ids.includes(h.actionId)), (h) => h.hours) };
  }

  const bomTotal = (b) => (Number(b.qty) || 0) * (Number(b.unitCost) || 0);

  function metrics(pid = UI.projectId) {
    const p = S.projects.find((x) => x.id === pid);
    const acts = projActions(pid);
    const leaves = acts.filter((a) => !hasKids(a.id));
    const w = sum(leaves, (a) => Math.max(a.estHours, 1));
    const scope = w ? sum(leaves, (a) => (a.status === 'Completed' ? 100 : a.progress) * Math.max(a.estHours, 1)) / w : 0;
    const doneLeaves = leaves.filter((a) => a.status === 'Completed').length;
    const blockers = S.blockers.filter((b) => b.projectId === pid);
    const active = blockers.filter((b) => b.status !== 'Resolved');
    const bom = S.bom.filter((b) => b.projectId === pid);
    const bomPct = bom.length ? (sum(bom, (b) => BOM_STATUS.indexOf(b.status) / (BOM_STATUS.length - 1)) / bom.length) * 100 : 0;
    const bomDone = bom.filter((b) => b.status === 'Delivered' || b.status === 'Installed').length;
    const bomCommitted = sum(bom.filter((b) => ['Ordered', 'Delivered', 'Installed'].includes(b.status)), bomTotal);
    const bomEstimate = sum(bom, bomTotal);
    const hrs = S.hours.filter((h) => h.projectId === pid);
    const logged = sum(hrs, (h) => h.hours);
    const est = sum(leaves, (a) => a.estHours);
    const labour = sum(hrs, (h) => h.hours * ((member(h.memberId) || {}).rate || 0));
    const spend = labour + bomCommitted;
    const budget = p ? Number(p.budget) || 0 : 0;
    const qh = S.qhse.filter((q) => q.projectId === pid && q.category === 'QHSE');
    const qa = S.qhse.filter((q) => q.projectId === pid && q.category !== 'QHSE');
    return {
      scope: pct(scope), leaves: leaves.length, doneLeaves,
      blockersActive: active.length, blockersEscalated: active.filter((b) => b.status === 'Escalated').length, blockersCritical: active.filter((b) => b.severity === 'Critical').length,
      bomPct: pct(bomPct), bomCount: bom.length, bomDone, bomCommitted, bomEstimate,
      logged, est, hoursPct: est ? pct((logged / est) * 100) : 0, hoursRaw: est ? (logged / est) * 100 : 0,
      labour, spend, budget, budgetPct: budget ? (spend / budget) * 100 : 0,
      qhseChecked: qh.filter((q) => q.checked).length, qhseTotal: qh.length, qhsePct: qh.length ? pct((qh.filter((q) => q.checked).length / qh.length) * 100) : 0,
      qaChecked: qa.filter((q) => q.checked).length, qaTotal: qa.length, qaPct: qa.length ? pct((qa.filter((q) => q.checked).length / qa.length) * 100) : 0
    };
  }

  const matchQ = (...parts) => !UI.q || parts.join(' ').toLowerCase().includes(UI.q.toLowerCase());
  function matchAction(a) {
    const as = member(a.assigneeId);
    if (UI.phase && a.phase !== UI.phase) return false;
    if (UI.assignee && a.assigneeId !== UI.assignee) return false;
    if (UI.status && effStatus(a) !== UI.status) return false;
    return matchQ(a.title, a.description, phaseShort(a.phase), as ? as.name : '', a.priority, effStatus(a));
  }
  const matchTree = (a) => matchAction(a) || kidsOf(a.id).some(matchAction);

  function treeRows(acts) {
    const rows = [];
    PHASES.map((p) => p.key).concat(['']).forEach((key) => {
      acts.filter((a) => !a.parentId && (a.phase || '') === key).sort((x, y) => x.start.localeCompare(y.start)).forEach((top) => {
        rows.push({ a: top, level: 0 });
        kidsOf(top.id).sort((x, y) => x.start.localeCompare(y.start)).forEach((k) => rows.push({ a: k, level: 1 }));
      });
    });
    return rows;
  }

  /* =====================================================================
     5. UI primitives
     ===================================================================== */
  const statusCls = (s) => ({ Backlog: 'st-backlog', 'In Progress': 'st-progress', Commissioning: 'st-comm', Blocked: 'st-blocked', Completed: 'st-done' }[s] || '');
  const priCls = (s) => `pri-${String(s || 'Medium').toLowerCase()}`;
  const badge = (txt, cls = '') => `<span class="badge ${cls}">${esc(txt)}</span>`;
  const bar = (v, cls = '') => `<div class="bar ${cls}" role="progressbar" aria-valuenow="${pct(v)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct(v)}%"></span></div>`;
  const optList = (list) => list.map((x) => (typeof x === 'string' ? { value: x, label: x } : x));
  const optionsHtml = (list, val, blank) => (blank != null ? `<option value="">${esc(blank)}</option>` : '') + optList(list).map((o) => `<option value="${esc(o.value)}"${String(o.value) === String(val) ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
  const teamOpts = () => S.team.map((t) => ({ value: t.id, label: `${t.name} — ${t.role}` }));
  const toneFor = (v, warnAt, badAt) => (v >= badAt ? 'danger' : v >= warnAt ? 'warn' : 'ok');

  function toast(msg, type = 'info') {
    const root = $('#toastRoot');
    if (!root) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, 3600);
  }

  let lastFocus = null;
  function openModal({ title, body, wide }) {
    lastFocus = document.activeElement;
    $('#modalRoot').innerHTML = `<div class="modal-backdrop"><div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
      <div class="modal-head"><h2 id="modalTitle">${esc(title)}</h2><button type="button" class="icon-btn" data-act="modal-close" aria-label="Close">×</button></div>
      <div class="modal-body">${body}</div></div></div>`;
    const first = $('#modalRoot input:not([type=hidden]), #modalRoot select, #modalRoot textarea');
    if (first) first.focus();
  }
  function closeModal() {
    $('#modalRoot').innerHTML = '';
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) { /* ignore */ } }
  }

  function fieldHtml(f, val) {
    const v = val != null ? val : (f.default != null ? f.default : '');
    const id = `f_${f.name}`;
    const cls = `field${f.full ? ' full' : ''}`;
    const req = f.required ? ' <i class="req" aria-hidden="true">*</i>' : '';
    const help = f.help ? `<small class="muted">${esc(f.help)}</small>` : '';
    if (f.type === 'select') return `<div class="${cls}"><label for="${id}">${esc(f.label)}${req}</label><select id="${id}" name="${f.name}">${optionsHtml(f.options, v, f.blank)}</select>${help}</div>`;
    if (f.type === 'textarea') return `<div class="${cls}"><label for="${id}">${esc(f.label)}${req}</label><textarea id="${id}" name="${f.name}" rows="${f.rows || 3}" placeholder="${esc(f.placeholder || '')}">${esc(v)}</textarea>${help}</div>`;
    if (f.type === 'checkbox') return `<div class="${cls} check"><label><input type="checkbox" id="${id}" name="${f.name}"${v ? ' checked' : ''}> ${esc(f.label)}</label>${help}</div>`;
    if (f.type === 'range') return `<div class="${cls}"><label for="${id}">${esc(f.label)} <output>${esc(v || 0)}%</output></label><input type="range" id="${id}" name="${f.name}" min="${f.min || 0}" max="${f.max || 100}" step="${f.step || 5}" value="${esc(v || 0)}"></div>`;
    const extra = f.type === 'number' ? ` min="${f.min != null ? f.min : 0}"${f.max != null ? ` max="${f.max}"` : ''} step="${f.step || 'any'}"` : '';
    return `<div class="${cls}"><label for="${id}">${esc(f.label)}${req}</label><input id="${id}" name="${f.name}" type="${f.type || 'text'}" value="${esc(v)}" placeholder="${esc(f.placeholder || '')}"${extra}>${help}</div>`;
  }

  function openForm({ title, fields, values = {}, submit = 'Save', validate, onSubmit, note, wide }) {
    const html = `<form id="entityForm" novalidate>
      <div class="form-grid">${fields.map((f) => fieldHtml(f, values[f.name])).join('')}</div>
      ${note ? `<p class="muted small">${esc(note)}</p>` : ''}
      <p id="formError" class="form-error" role="alert"></p>
      <div class="modal-actions"><button type="button" class="btn ghost" data-act="modal-close">Cancel</button><button type="submit" class="btn primary">${esc(submit)}</button></div>
    </form>`;
    openModal({ title, body: html, wide });
    const form = $('#entityForm');
    const showErr = (m, el) => { $('#formError').textContent = m; if (el && el.focus) el.focus(); };
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const d = {};
      for (const f of fields) {
        const el = form.elements[f.name];
        let v;
        if (f.type === 'checkbox') v = el.checked;
        else if (f.type === 'number' || f.type === 'range') v = el.value === '' ? 0 : Number(el.value);
        else v = String(el.value || '').trim();
        if (f.required && (v === '' || v == null)) { showErr(`${f.label} is required.`, el); return; }
        d[f.name] = v;
      }
      const msg = validate ? validate(d) : '';
      if (msg) { showErr(msg); return; }
      try { await onSubmit(d); } catch (e) { console.error(e); showErr('Could not save. Please try again.'); return; }
      closeModal();
      render();
    });
  }

  function confirmBox(msg) { return typeof window.confirm === 'function' ? window.confirm(msg) : true; }

  /* =====================================================================
     6. Views
     ===================================================================== */
  const noProject = () => `<section class="card empty"><h2>No project selected</h2><p class="muted">Create your first automation project or restore the demo workspace.</p>
    <div class="row"><button class="btn primary" data-act="new-project">New Project</button><button class="btn ghost" data-act="reset-demo">Load Demo Data</button></div></section>`;

  function kpi(label, value, sub, v, tone, extra = '') {
    return `<article class="kpi ${tone}"><h3>${esc(label)}</h3><div class="kpi-value">${value}</div>${bar(v, tone)}${extra}<p class="small muted">${sub}</p></article>`;
  }

  function actionRow(a, level) {
    const as = member(a.assigneeId);
    const st = effStatus(a);
    const pr = effProgress(a);
    const hs = actHours(a);
    return `<div class="wbs-row lvl${level}">
      <div class="wbs-main">
        <strong>${esc(a.title)}</strong>
        <span class="small muted">${esc(as ? as.name : 'Unassigned')} · ${fmtShort(a.start)} → ${fmtShort(a.end)} · ${hs.logged}/${hs.est} h</span>
      </div>
      <div class="wbs-meta">${badge(a.priority, priCls(a.priority))}${badge(st, statusCls(st))}</div>
      <div class="wbs-prog">${bar(pr, st === 'Blocked' ? 'danger' : '')}<span class="small">${pr}%</span></div>
      <div class="wbs-btns">
        <button class="btn ghost xs" data-act="decompose" data-id="${a.id}" title="Break into sub-actions">Split</button>
        <button class="btn ghost xs" data-act="edit-action" data-id="${a.id}">Edit</button>
        <button class="btn ghost xs danger-text" data-act="delete-action" data-id="${a.id}">Delete</button>
      </div>
    </div>`;
  }

  function wbsTree() {
    const acts = projActions();
    if (!acts.length) return `<div class="empty-inline"><p>No actions yet. Break this project down in one click.</p><button class="btn primary" data-act="wbs-template">Auto-Generate SCADA WBS Template</button></div>`;
    const keys = PHASES.map((p) => p.key).concat(['']);
    const html = keys.map((key) => {
      const tops = acts.filter((a) => !a.parentId && (a.phase || '') === key && matchTree(a)).sort((x, y) => x.start.localeCompare(y.start));
      if (!tops.length) return '';
      const allTops = acts.filter((a) => !a.parentId && (a.phase || '') === key);
      const pr = allTops.length ? sum(allTops, effProgress) / allTops.length : 0;
      const ph = phaseOf(key);
      return `<section class="phase"><header class="phase-head"><h3>${esc(ph ? ph.name : 'Unphased actions')}</h3><div class="phase-prog">${bar(pr)}<span class="small">${pct(pr)}%</span></div></header>
        ${tops.map((t) => actionRow(t, 0) + kidsOf(t.id).filter((k) => matchAction(k) || matchAction(t)).sort((x, y) => x.start.localeCompare(y.start)).map((k) => actionRow(k, 1)).join('')).join('')}</section>`;
    }).join('');
    return html || '<p class="muted">No actions match the current search.</p>';
  }

  function viewDashboard() {
    const p = P();
    if (!p) return noProject();
    const m = metrics();
    const left = daysBetween(today(), p.deadline);
    const dueTxt = left < 0 ? `${Math.abs(left)} days overdue` : `${left} days remaining`;
    const budgetTone = m.budgetPct > m.scope + 25 ? 'danger' : m.budgetPct > m.scope + 10 ? 'warn' : 'ok';
    return `
    <section class="card project-card">
      <div class="card-head">
        <div><h2>${esc(p.name)}</h2><p class="muted small">${esc(p.client)} · ${esc(p.location || '')}</p></div>
        <div class="row">${badge(p.status, p.status === 'Active' ? 'st-progress' : p.status === 'Completed' ? 'st-done' : 'st-backlog')}
          <button class="btn ghost sm" data-act="edit-project">Edit</button>
          <button class="btn ghost sm" data-act="new-project">New Project</button>
          <button class="btn ghost sm danger-text" data-act="delete-project">Delete</button></div>
      </div>
      <div class="grid-2">
        <div><h4>Objective</h4><p>${esc(p.objective) || '<span class="muted">Not defined</span>'}</p></div>
        <div><h4>Scope definition</h4><p>${esc(p.scope) || '<span class="muted">Not defined</span>'}</p></div>
      </div>
      <dl class="facts">
        <div><dt>Start</dt><dd>${fmtDate(p.start)}</dd></div>
        <div><dt>Deadline</dt><dd>${fmtDate(p.deadline)}</dd></div>
        <div><dt>Schedule</dt><dd class="${left < 0 ? 'text-danger' : ''}">${dueTxt}</dd></div>
        <div><dt>Budget</dt><dd>${aed(p.budget)}</dd></div>
        <div><dt>Project Manager</dt><dd>${esc(p.manager || '—')}</dd></div>
      </dl>
    </section>

    <section class="kpi-grid" aria-label="Key performance indicators">
      ${kpi('Scope Completion', `${m.scope}%`, `${m.doneLeaves} of ${m.leaves} actions complete`, m.scope, 'ok')}
      ${kpi('Active Blockers', m.blockersActive, `${m.blockersEscalated} escalated · ${m.blockersCritical} critical`, Math.min(100, m.blockersActive * 25), toneFor(m.blockersActive, 1, 3))}
      ${kpi('BOM Procurement', `${m.bomPct}%`, `${m.bomDone} of ${m.bomCount} items delivered/installed`, m.bomPct, 'ok')}
      ${kpi('Hours & Budget Burn', `${pct(m.hoursRaw)}% <small>hrs</small> · ${Math.round(m.budgetPct)}% <small>AED</small>`, `${m.logged}/${m.est} h · ${aed(m.spend)} of ${aed(m.budget)}`, m.budgetPct, budgetTone)}
      ${kpi('QHSE Compliance', `${m.qhsePct}%`, `${m.qhseChecked} of ${m.qhseTotal} Annexure-SCT-HR-001 controls`, m.qhsePct, m.qhsePct >= 80 ? 'ok' : m.qhsePct >= 50 ? 'warn' : 'danger')}
    </section>

    <section class="card">
      <div class="card-head"><h2>Scope Work Breakdown Structure</h2>
        <div class="row"><button class="btn ghost sm" data-act="wbs-template">Auto-Generate SCADA WBS Template</button><button class="btn primary sm" data-act="new-action">+ Add Action</button></div>
      </div>
      ${wbsTree()}
    </section>`;
  }

  function filterBar() {
    const acts = projActions();
    const phaseOpts = PHASES.map((p) => ({ value: p.key, label: p.short }));
    return `<div class="toolbar">
      <label>Phase<select data-change="filter" data-key="phase">${optionsHtml(phaseOpts, UI.phase, 'All phases')}</select></label>
      <label>Assignee<select data-change="filter" data-key="assignee">${optionsHtml(S.team.filter((t) => acts.some((a) => a.assigneeId === t.id)).map((t) => ({ value: t.id, label: t.name })), UI.assignee, 'Everyone')}</select></label>
      <label>Status<select data-change="filter" data-key="status">${optionsHtml(ACTION_STATUS, UI.status, 'All statuses')}</select></label>
      <div class="seg" role="group" aria-label="Layout">
        <button type="button" class="${UI.layout === 'kanban' ? 'on' : ''}" data-act="layout" data-v="kanban">Kanban</button>
        <button type="button" class="${UI.layout === 'list' ? 'on' : ''}" data-act="layout" data-v="list">List</button>
      </div>
      <button class="btn ghost sm" data-act="clear-filters">Clear</button>
      <span class="spacer"></span>
      <button class="btn primary sm" data-act="new-action">+ New Action</button>
    </div>`;
  }

  function kCard(a) {
    const as = member(a.assigneeId);
    const par = a.parentId ? S.actions.find((x) => x.id === a.parentId) : null;
    const hs = actHours(a);
    const late = a.status !== 'Completed' && a.end < today();
    return `<article class="kcard ${priCls(a.priority)}">
      <div class="kcard-top">${badge(phaseShort(a.phase), 'phase')}${badge(a.priority, priCls(a.priority))}${late ? badge('Overdue', 'st-blocked') : ''}</div>
      <h4>${esc(a.title)}</h4>
      ${par ? `<p class="small muted">↳ ${esc(par.title)}</p>` : ''}
      <p class="small">${esc(as ? as.name : 'Unassigned')} · ${fmtShort(a.start)} → ${fmtShort(a.end)}</p>
      <p class="small muted">${hs.logged}/${hs.est} h logged</p>
      <label class="slider"><span>Progress <b data-out>${a.progress}%</b></span>
        <input type="range" min="0" max="100" step="5" value="${a.progress}" data-input="progress" data-change="progress" data-id="${a.id}" aria-label="Progress for ${esc(a.title)}"></label>
      <div class="kcard-actions">
        <select data-change="action-status" data-id="${a.id}" aria-label="Status">${optionsHtml(ACTION_STATUS, a.status)}</select>
        <button class="btn ghost xs" data-act="decompose" data-id="${a.id}">Split</button>
        <button class="btn ghost xs" data-act="edit-action" data-id="${a.id}">Edit</button>
        <button class="btn ghost xs danger-text" data-act="delete-action" data-id="${a.id}">Del</button>
      </div>
    </article>`;
  }

  function ganttHtml(rows) {
    const p = P();
    if (!rows.length) return '<p class="muted">Nothing to schedule yet.</p>';
    let min = p.start;
    let max = p.deadline;
    rows.forEach(({ a }) => { if (a.start < min) min = a.start; if (a.end > max) max = a.end; });
    const total = Math.max(daysBetween(min, max), 1);
    const pos = (s) => Math.min(100, Math.max(0, (daysBetween(min, s) / total) * 100));
    const tdy = pos(today());
    return `<div class="gantt"><div class="gantt-scale"><span>${fmtDate(min)}</span><span>Today</span><span>${fmtDate(max)}</span></div>
      <div class="gantt-body"><i class="gantt-today" style="left:calc(32% + (100% - 32%) * ${(tdy / 100).toFixed(4)})" title="Today"></i>
      ${rows.map(({ a, level }) => {
        const l = pos(a.start);
        const w = Math.max(pos(a.end) - l, 1.4);
        const st = effStatus(a);
        const pr = effProgress(a);
        return `<div class="gantt-row ${level ? 'child' : 'parent'}"><div class="gantt-label" title="${esc(a.title)}">${esc(a.title)}</div>
          <div class="gantt-track"><span class="gantt-bar ${statusCls(st)}" style="left:${l}%;width:${w}%"><span style="width:${pr}%"></span></span></div></div>`;
      }).join('')}</div></div>`;
  }

  function viewActions() {
    const p = P();
    if (!p) return noProject();
    const acts = projActions();
    const leaves = acts.filter((a) => !hasKids(a.id) && matchAction(a));
    let body;
    if (UI.layout === 'kanban') {
      body = `<div class="kanban">${ACTION_STATUS.map((st) => {
        const col = leaves.filter((a) => a.status === st);
        return `<section class="kcol ${statusCls(st)}"><header><h3>${st}</h3><span class="count">${col.length}</span></header>${col.map(kCard).join('') || '<p class="muted small empty-col">No actions</p>'}</section>`;
      }).join('')}</div>`;
    } else {
      const rows = treeRows(acts).filter(({ a }) => matchTree(a));
      body = `<div class="table-wrap"><table class="data-table"><thead><tr><th>Action</th><th>Phase</th><th>Assignee</th><th>Priority</th><th>Status</th><th>Progress</th><th>Timeframe</th><th>Hours</th><th></th></tr></thead><tbody>
      ${rows.map(({ a, level }) => {
        const as = member(a.assigneeId);
        const st = effStatus(a);
        const hs = actHours(a);
        return `<tr class="${level ? 'child' : 'parent'}"><td class="lvl${level}"><strong>${esc(a.title)}</strong></td><td>${esc(phaseShort(a.phase))}</td><td>${esc(as ? as.name : '—')}</td><td>${badge(a.priority, priCls(a.priority))}</td><td>${badge(st, statusCls(st))}</td>
          <td class="nowrap">${bar(effProgress(a))}<span class="small">${effProgress(a)}%</span></td><td class="nowrap">${fmtShort(a.start)} → ${fmtShort(a.end)}</td><td class="nowrap">${hs.logged}/${hs.est}</td>
          <td class="nowrap"><button class="btn ghost xs" data-act="decompose" data-id="${a.id}">Split</button> <button class="btn ghost xs" data-act="edit-action" data-id="${a.id}">Edit</button> <button class="btn ghost xs danger-text" data-act="delete-action" data-id="${a.id}">Del</button></td></tr>`;
      }).join('') || '<tr><td colspan="9" class="muted">No actions match.</td></tr>'}</tbody></table></div>`;
    }
    const ganttRows = treeRows(acts).filter(({ a }) => matchTree(a));
    return `${filterBar()}${body}<section class="card"><div class="card-head"><h2>Schedule Timeline</h2><span class="muted small">Bars show timeframe; fill shows progress</span></div>${ganttHtml(ganttRows)}</section>`;
  }

  function viewBom() {
    const p = P();
    if (!p) return noProject();
    const items = S.bom.filter((b) => b.projectId === p.id);
    const m = metrics();
    const shown = items.filter((b) => (!UI.bomStatus || b.status === UI.bomStatus) && matchQ(b.name, b.vendor, b.category, b.notes, b.status));
    const stageCounts = BOM_STATUS.map((s) => `<div class="chip">${s}<b>${items.filter((b) => b.status === s).length}</b></div>`).join('');
    return `
    <section class="kpi-grid compact">
      ${kpi('Procurement Progress', `${m.bomPct}%`, `${m.bomDone} of ${m.bomCount} delivered/installed`, m.bomPct, 'ok')}
      ${kpi('BOM Estimate', aed(m.bomEstimate), `${items.length} line items`, 100, 'ok')}
      ${kpi('Committed Spend', aed(m.bomCommitted), 'Ordered, delivered or installed', m.bomEstimate ? (m.bomCommitted / m.bomEstimate) * 100 : 0, 'warn')}
    </section>
    <div class="chips">${stageCounts}</div>
    <div class="toolbar">
      <label>Status<select data-change="filter" data-key="bomStatus">${optionsHtml(BOM_STATUS, UI.bomStatus, 'All statuses')}</select></label>
      <button class="btn ghost sm" data-act="clear-filters">Clear</button><span class="spacer"></span>
      <button class="btn primary sm" data-act="new-bom">+ Add BOM Item</button>
    </div>
    <div class="table-wrap"><table class="data-table"><thead><tr><th>Item</th><th>Category</th><th class="num">Qty</th><th class="num">Unit (AED)</th><th class="num">Total (AED)</th><th>Vendor / Lead time</th><th>Status</th><th>Site survey / risk notes</th><th></th></tr></thead><tbody>
    ${shown.map((b) => `<tr><td><strong>${esc(b.name)}</strong></td><td>${esc(b.category)}</td><td class="num">${b.qty}</td><td class="num">${Number(b.unitCost).toLocaleString('en-US')}</td><td class="num">${bomTotal(b).toLocaleString('en-US')}</td>
      <td>${esc(b.vendor || '—')}<br><span class="small muted">${b.leadDays || 0} days lead</span></td>
      <td><select class="inline-select ${'bs-' + slug(b.status)}" data-change="bom-status" data-id="${b.id}" aria-label="Procurement status">${optionsHtml(BOM_STATUS, b.status)}</select></td>
      <td class="notes-cell">${esc(b.notes) || '<span class="muted">—</span>'}</td>
      <td class="nowrap"><button class="btn ghost xs" data-act="edit-bom" data-id="${b.id}">Edit</button> <button class="btn ghost xs danger-text" data-act="delete-bom" data-id="${b.id}">Del</button></td></tr>`).join('') || '<tr><td colspan="9" class="muted">No BOM items match.</td></tr>'}
    </tbody><tfoot><tr><td colspan="4">Total (shown)</td><td class="num">${sum(shown, bomTotal).toLocaleString('en-US')}</td><td colspan="4"></td></tr></tfoot></table></div>`;
  }

  function viewResources() {
    const p = P();
    if (!p) return noProject();
    const m = metrics();
    const acts = leafActions();
    const hrs = S.hours.filter((h) => h.projectId === p.id);
    const blockers = S.blockers.filter((b) => b.projectId === p.id && matchQ(b.title, b.description, b.impact, b.severity, b.status));
    const forecast = m.scope >= 5 ? (m.spend / m.scope) * 100 : 0;
    const memberRows = S.team.map((t) => {
      const logged = sum(hrs.filter((h) => h.memberId === t.id), (h) => h.hours);
      const est = sum(acts.filter((a) => a.assigneeId === t.id), (a) => a.estHours);
      return `<tr><td><strong>${esc(t.name)}</strong></td><td>${esc(t.role)}</td><td class="num">${t.rate}</td><td class="num">${est}</td><td class="num">${logged}</td><td class="nowrap">${bar(est ? (logged / est) * 100 : 0, est && logged > est ? 'danger' : '')}</td><td class="num">${Math.round(logged * t.rate).toLocaleString('en-US')}</td>
        <td class="nowrap"><button class="btn ghost xs" data-act="edit-member" data-id="${t.id}">Edit</button> <button class="btn ghost xs danger-text" data-act="delete-member" data-id="${t.id}">Del</button></td></tr>`;
    }).join('');
    const hoursRows = hrs.filter((h) => { const a = S.actions.find((x) => x.id === h.actionId); const t = member(h.memberId); return matchQ(h.note, a ? a.title : '', t ? t.name : ''); })
      .sort((x, y) => y.date.localeCompare(x.date)).map((h) => {
        const a = S.actions.find((x) => x.id === h.actionId);
        const t = member(h.memberId);
        return `<tr><td class="nowrap">${fmtDate(h.date)}</td><td>${esc(t ? t.name : '—')}</td><td>${esc(a ? a.title : '—')}</td><td class="num">${h.hours}</td><td class="num">${Math.round(h.hours * (t ? t.rate : 0)).toLocaleString('en-US')}</td><td>${esc(h.note)}</td>
          <td class="nowrap"><button class="btn ghost xs" data-act="edit-hours" data-id="${h.id}">Edit</button> <button class="btn ghost xs danger-text" data-act="delete-hours" data-id="${h.id}">Del</button></td></tr>`;
      }).join('');
    const blockerRows = blockers.sort((x, y) => (x.status === 'Resolved') - (y.status === 'Resolved') || SEVERITY.indexOf(y.severity) - SEVERITY.indexOf(x.severity)).map((b) => {
      const o = member(b.ownerId);
      const a = S.actions.find((x) => x.id === b.actionId);
      return `<article class="blocker sev-${String(b.severity).toLowerCase()} ${b.status === 'Resolved' ? 'resolved' : ''}">
        <header><h4>${esc(b.title)}</h4><div class="row">${badge(b.severity, priCls(b.severity))}${badge(b.status, b.status === 'Resolved' ? 'st-done' : b.status === 'Escalated' ? 'st-comm' : 'st-blocked')}</div></header>
        <p>${esc(b.description)}</p>
        <p class="small"><b>Impact:</b> ${esc(b.impact) || '—'}</p>
        <p class="small"><b>Support needed:</b> ${esc(b.needed) || '—'}</p>
        <p class="small muted">Owner: ${esc(o ? o.name : '—')} · Linked: ${esc(a ? a.title : '—')} · Raised ${fmtShort(b.raised)} · Target ${fmtShort(b.target)}${b.escalatedTo ? ` · Escalated to ${esc(b.escalatedTo)} on ${fmtShort(b.escalatedAt)}` : ''}</p>
        <div class="row">
          ${b.status !== 'Resolved' ? `<button class="btn ghost xs" data-act="escalate-blocker" data-id="${b.id}">Escalate to PM</button><button class="btn ghost xs" data-act="copy-escalation" data-id="${b.id}">Copy escalation note</button><button class="btn ghost xs" data-act="resolve-blocker" data-id="${b.id}">Mark resolved</button>` : `<button class="btn ghost xs" data-act="reopen-blocker" data-id="${b.id}">Reopen</button>`}
          <button class="btn ghost xs" data-act="edit-blocker" data-id="${b.id}">Edit</button><button class="btn ghost xs danger-text" data-act="delete-blocker" data-id="${b.id}">Delete</button>
        </div></article>`;
    }).join('') || '<p class="muted">No blockers recorded.</p>';
    return `
    <section class="card"><div class="card-head"><h2>Budget & Expenditure (AED)</h2></div>
      <div class="budget-grid">
        <div><span class="muted small">Budget</span><strong>${aed(m.budget)}</strong></div>
        <div><span class="muted small">Labour cost</span><strong>${aed(m.labour)}</strong></div>
        <div><span class="muted small">Procurement committed</span><strong>${aed(m.bomCommitted)}</strong></div>
        <div><span class="muted small">Total spend</span><strong>${aed(m.spend)}</strong></div>
        <div><span class="muted small">Remaining</span><strong class="${m.budget - m.spend < 0 ? 'text-danger' : ''}">${aed(m.budget - m.spend)}</strong></div>
        <div><span class="muted small">Forecast at completion</span><strong>${forecast ? aed(forecast) : '—'}</strong></div>
      </div>
      ${bar(m.budgetPct, toneFor(m.budgetPct, 75, 95))}
      <p class="small muted">Budget burn ${Math.round(m.budgetPct)}% vs scope completion ${m.scope}% · Hours ${m.logged}/${m.est}</p></section>

    <section class="card"><div class="card-head"><h2>Team & Assignments</h2><button class="btn primary sm" data-act="new-member">+ Add Engineer</button></div>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Engineer</th><th>Role</th><th class="num">Rate AED/h</th><th class="num">Est. h</th><th class="num">Logged h</th><th>Utilisation</th><th class="num">Cost AED</th><th></th></tr></thead><tbody>${memberRows}</tbody></table></div></section>

    <section class="card"><div class="card-head"><h2>Hours Log</h2><button class="btn primary sm" data-act="log-hours">+ Log Hours</button></div>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Engineer</th><th>Action</th><th class="num">Hours</th><th class="num">Cost AED</th><th>Note</th><th></th></tr></thead><tbody>${hoursRows || '<tr><td colspan="7" class="muted">No hours logged.</td></tr>'}</tbody></table></div></section>

    <section class="card"><div class="card-head"><h2>Blockers & Escalation Log</h2><button class="btn primary sm" data-act="new-blocker">+ Record Blocker</button></div>
      <div class="blockers">${blockerRows}</div></section>`;
  }

  function viewDocs() {
    const p = P();
    if (!p) return noProject();
    const m = metrics();
    const docs = S.docs.filter((d) => d.projectId === p.id && matchQ(d.title, d.type, d.status, d.owner, d.notes));
    const notes = S.notes.filter((n) => n.projectId === p.id && (!UI.noteCat || n.category === UI.noteCat) && matchQ(n.title, n.body, n.category))
      .sort((x, y) => y.date.localeCompare(x.date));
    const hasQa = S.qhse.some((q) => q.projectId === p.id);
    const qaCards = QA_CATS.map((c) => {
      const items = S.qhse.filter((q) => q.projectId === p.id && q.category === c.key && matchQ(q.text, q.ref, c.label));
      const all = S.qhse.filter((q) => q.projectId === p.id && q.category === c.key);
      const done = all.filter((q) => q.checked).length;
      const v = all.length ? (done / all.length) * 100 : 0;
      return `<section class="card qa-card"><div class="card-head"><div><h3>${esc(c.label)}</h3><span class="small muted">${done}/${all.length} complete</span></div><button class="btn ghost xs" data-act="new-qa" data-cat="${c.key}">+ Item</button></div>${bar(v, v >= 80 ? 'ok' : v >= 50 ? 'warn' : 'danger')}
        <ul class="checklist">${items.map((q) => `<li><label><input type="checkbox" data-change="qa-toggle" data-id="${q.id}"${q.checked ? ' checked' : ''}><span>${esc(q.text)}</span></label><button class="icon-btn" data-act="delete-qa" data-id="${q.id}" aria-label="Delete item">×</button></li>`).join('') || '<li class="muted small">No items.</li>'}</ul></section>`;
    }).join('');
    return `
    <section class="card"><div class="card-head"><h2>Technical Documentation</h2><div class="row"><button class="btn ghost sm" data-act="load-qa-template"${hasQa ? ' hidden' : ''}>Load QA/QHSE Checklists</button><button class="btn primary sm" data-act="new-doc">+ Add Document</button></div></div>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Document</th><th>Type</th><th>Rev</th><th>Owner</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>
      ${docs.map((d) => `<tr><td><strong>${esc(d.title)}</strong>${d.notes ? `<br><span class="small muted">${esc(d.notes)}</span>` : ''}</td><td>${esc(d.type)}</td><td>${esc(d.rev)}</td><td>${esc(d.owner || '—')}</td><td class="nowrap">${fmtShort(d.due)}</td>
        <td><select class="inline-select ds-${slug(d.status)}" data-change="doc-status" data-id="${d.id}" aria-label="Document status">${optionsHtml(DOC_STATUS, d.status)}</select></td>
        <td class="nowrap"><button class="btn ghost xs" data-act="edit-doc" data-id="${d.id}">Edit</button> <button class="btn ghost xs danger-text" data-act="delete-doc" data-id="${d.id}">Del</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted">No documents.</td></tr>'}
      </tbody></table></div></section>

    <div class="score-row">
      <div class="score"><span>QHSE compliance</span><strong class="${m.qhsePct >= 80 ? 'text-ok' : m.qhsePct >= 50 ? 'text-warn' : 'text-danger'}">${m.qhsePct}%</strong><small>Annexure-SCT-HR-001</small></div>
      <div class="score"><span>FAT / SAT readiness</span><strong>${m.qaPct}%</strong><small>${m.qaChecked}/${m.qaTotal} tests passed</small></div>
    </div>
    <div class="qa-grid">${qaCards}</div>

    <section class="card"><div class="card-head"><h2>Protocol, OPC & SQL Troubleshooting Log</h2>
      <div class="row"><select data-change="filter" data-key="noteCat" aria-label="Category">${optionsHtml(NOTE_CATS, UI.noteCat, 'All categories')}</select><button class="btn primary sm" data-act="new-note">+ Add Note</button></div></div>
      <div class="notes">${notes.map((n) => `<article class="note"><header><h4>${esc(n.title)}</h4><div class="row">${badge(n.category, 'phase')}<span class="small muted">${fmtShort(n.date)}</span></div></header><pre>${esc(n.body)}</pre>
        <div class="row"><button class="btn ghost xs" data-act="edit-note" data-id="${n.id}">Edit</button><button class="btn ghost xs danger-text" data-act="delete-note" data-id="${n.id}">Delete</button></div></article>`).join('') || '<p class="muted">No notes match.</p>'}</div></section>`;
  }

  /* =====================================================================
     7. Rendering
     ===================================================================== */
  function render() {
    const views = { dashboard: viewDashboard, actions: viewActions, bom: viewBom, resources: viewResources, docs: viewDocs };
    const view = $('#view');
    if (!view) return;
    view.innerHTML = (views[UI.view] || viewDashboard)();
    $$('.nav button').forEach((b) => {
      const on = b.dataset.view === UI.view;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    const title = $('#pageTitle');
    if (title) title.textContent = TITLES[UI.view];
    const sw = $('#projectSwitch');
    if (sw) {
      sw.innerHTML = S.projects.length ? S.projects.map((p) => `<option value="${esc(p.id)}"${p.id === UI.projectId ? ' selected' : ''}>${esc(p.name)}</option>`).join('') : '<option value="">No projects</option>';
    }
  }

  function setView(v, push = true) {
    UI.view = TITLES[v] ? v : 'dashboard';
    if (push) { try { history.replaceState(null, '', `#${UI.view}`); } catch (e) { /* ignore */ } }
    render();
    window.scrollTo(0, 0);
  }

  /* =====================================================================
     8. Forms for entities
     ===================================================================== */
  function projectForm(p) {
    const editing = !!p;
    const base = p || { name: '', client: '', location: 'Dubai, U.A.E.', status: 'Planning', objective: '', scope: '', manager: 'Sara Haddad', start: today(), deadline: addDays(today(), 90), budget: 250000 };
    openForm({
      title: editing ? 'Edit Project' : 'New Project', values: base, wide: true,
      fields: [
        { name: 'name', label: 'Project name', required: true, full: true },
        { name: 'client', label: 'Client', required: true },
        { name: 'location', label: 'Site location' },
        { name: 'status', label: 'Status', type: 'select', options: PROJECT_STATUS },
        { name: 'manager', label: 'Project Manager' },
        { name: 'start', label: 'Start date', type: 'date', required: true },
        { name: 'deadline', label: 'Deadline', type: 'date', required: true },
        { name: 'budget', label: 'Budget (AED)', type: 'number' },
        { name: 'objective', label: 'Objectives', type: 'textarea', full: true },
        { name: 'scope', label: 'Scope definition (in / out)', type: 'textarea', full: true }
      ],
      validate: (d) => (d.deadline < d.start ? 'Deadline must be on or after the start date.' : ''),
      onSubmit: async (d) => {
        const rec = Object.assign({}, editing ? p : { id: uid('prj') }, d);
        await save('projects', rec);
        if (!editing) {
          UI.projectId = rec.id;
          localStorage.setItem(LS_PROJECT, rec.id);
          for (const q of qaTemplate(rec.id)) await save('qhse', q);
          for (const x of docTemplate(rec.id)) await save('docs', x);
          toast('Project created. Use "Auto-Generate SCADA WBS Template" to break it down.', 'ok');
        } else toast('Project updated.', 'ok');
      }
    });
  }

  function actionForm(a, preset = {}) {
    const p = P();
    const editing = !!(a && a.id);
    const base = a || Object.assign({ title: '', description: '', phase: 'P1', parentId: '', assigneeId: (S.team[0] || {}).id || '', priority: 'Medium', status: 'Backlog', progress: 0, start: today(), end: addDays(today(), 7), estHours: 8 }, preset);
    const parentOpts = projActions().filter((x) => !x.parentId && (!a || x.id !== a.id)).map((x) => ({ value: x.id, label: x.title }));
    openForm({
      title: editing ? 'Edit Action' : 'New Action', values: base, wide: true,
      fields: [
        { name: 'title', label: 'Action title', required: true, full: true },
        { name: 'description', label: 'Description / deliverable', type: 'textarea', full: true, rows: 2 },
        { name: 'phase', label: 'Phase', type: 'select', options: PHASES.map((x) => ({ value: x.key, label: x.name })) },
        { name: 'parentId', label: 'Parent action', type: 'select', options: parentOpts, blank: '— None (top-level) —' },
        { name: 'assigneeId', label: 'Assignee', type: 'select', options: teamOpts(), blank: 'Unassigned' },
        { name: 'priority', label: 'Priority', type: 'select', options: PRIORITY },
        { name: 'status', label: 'Status', type: 'select', options: ACTION_STATUS },
        { name: 'estHours', label: 'Estimated hours', type: 'number' },
        { name: 'start', label: 'Start', type: 'date', required: true },
        { name: 'end', label: 'End', type: 'date', required: true },
        { name: 'progress', label: 'Progress', type: 'range', full: true }
      ],
      validate: (d) => {
        if (d.end < d.start) return 'End date must be on or after the start date.';
        if (d.parentId) {
          const par = S.actions.find((x) => x.id === d.parentId);
          if (par && (d.start < par.start || d.end > par.end)) return `Sub-action must fall within its parent timeframe (${par.start} → ${par.end}).`;
          if (editing && hasKids(a.id)) return 'An action that has sub-actions cannot itself become a sub-action.';
        }
        if (editing) {
          const bad = kidsOf(a.id).find((k) => k.start < d.start || k.end > d.end);
          if (bad) return `Sub-action "${bad.title}" falls outside this timeframe. Adjust it first.`;
        }
        return '';
      },
      onSubmit: async (d) => {
        const par = d.parentId ? S.actions.find((x) => x.id === d.parentId) : null;
        if (par) d.phase = par.phase;
        if (d.status === 'Completed') d.progress = 100;
        else if (d.progress === 100) d.status = 'Completed';
        else if (d.progress > 0 && d.status === 'Backlog') d.status = 'In Progress';
        const rec = Object.assign({}, editing ? a : { id: uid('act'), projectId: p.id }, d);
        await save('actions', rec);
        toast(editing ? 'Action updated.' : 'Action added.', 'ok');
      }
    });
  }

  function decomposeForm(a) {
    openForm({
      title: `Decompose: ${a.title}`, wide: true, submit: 'Create sub-actions',
      note: `One sub-action per line as "Title | hours". Parent timeframe: ${fmtDate(a.start)} → ${fmtDate(a.end)}.`,
      values: { assigneeId: a.assigneeId, priority: a.priority, split: true },
      fields: [
        { name: 'lines', label: 'Sub-actions', type: 'textarea', rows: 6, full: true, required: true, placeholder: 'Configure alarm groups | 8\nBuild trend pens | 6\nTest acknowledgement flow | 4' },
        { name: 'assigneeId', label: 'Assignee', type: 'select', options: teamOpts(), blank: 'Unassigned' },
        { name: 'priority', label: 'Priority', type: 'select', options: PRIORITY },
        { name: 'split', label: 'Spread sub-actions sequentially across the parent timeframe', type: 'checkbox', full: true }
      ],
      validate: (d) => (d.lines.split('\n').some((l) => l.trim()) ? '' : 'Enter at least one sub-action.'),
      onSubmit: async (d) => {
        const lines = d.lines.split('\n').map((l) => l.trim()).filter(Boolean);
        const span = Math.max(daysBetween(a.start, a.end), lines.length);
        let i = 0;
        for (const line of lines) {
          const [title, h] = line.split('|').map((x) => x.trim());
          let s = a.start;
          let e = a.end;
          if (d.split) {
            s = addDays(a.start, Math.floor((span * i) / lines.length));
            e = i === lines.length - 1 ? a.end : addDays(a.start, Math.floor((span * (i + 1)) / lines.length));
            if (s > a.end) s = a.end;
            if (e > a.end) e = a.end;
            if (e < s) e = s;
          }
          await save('actions', {
            id: uid('act'), projectId: a.projectId, parentId: a.id, phase: a.phase, title, description: '', assigneeId: d.assigneeId,
            priority: d.priority, status: 'Backlog', progress: 0, start: s, end: e, estHours: Number(h) || 4
          });
          i += 1;
        }
        toast(`${lines.length} sub-action${lines.length > 1 ? 's' : ''} created.`, 'ok');
      }
    });
  }

  function bomForm(b) {
    const editing = !!b;
    openForm({
      title: editing ? 'Edit BOM Item' : 'Add BOM Item', wide: true,
      values: b || { category: BOM_CATS[0], name: '', qty: 1, unitCost: 0, status: 'Specified', vendor: '', leadDays: 14, notes: '' },
      fields: [
        { name: 'name', label: 'Item / description', required: true, full: true },
        { name: 'category', label: 'Category', type: 'select', options: BOM_CATS },
        { name: 'status', label: 'Procurement status', type: 'select', options: BOM_STATUS },
        { name: 'qty', label: 'Quantity', type: 'number' },
        { name: 'unitCost', label: 'Unit cost (AED)', type: 'number' },
        { name: 'vendor', label: 'Vendor' },
        { name: 'leadDays', label: 'Lead time (days)', type: 'number' },
        { name: 'notes', label: 'Site survey risk / opportunity notes', type: 'textarea', full: true }
      ],
      validate: (d) => (d.qty <= 0 ? 'Quantity must be greater than zero.' : ''),
      onSubmit: async (d) => { await save('bom', Object.assign({}, editing ? b : { id: uid('bom'), projectId: P().id }, d)); toast('BOM saved.', 'ok'); }
    });
  }

  function memberForm(t) {
    const editing = !!t;
    openForm({
      title: editing ? 'Edit Engineer' : 'Add Engineer', values: t || { name: '', role: ROLES[0], rate: 150, email: '' },
      fields: [
        { name: 'name', label: 'Name', required: true },
        { name: 'role', label: 'Role', type: 'select', options: ROLES },
        { name: 'rate', label: 'Cost rate (AED / hour)', type: 'number' },
        { name: 'email', label: 'Email', type: 'email' }
      ],
      onSubmit: async (d) => { await save('team', Object.assign({}, editing ? t : { id: uid('tm') }, d)); toast('Team updated.', 'ok'); }
    });
  }

  function hoursForm(h) {
    const editing = !!h;
    const opts = leafActions().map((a) => ({ value: a.id, label: a.title }));
    openForm({
      title: editing ? 'Edit Hours Entry' : 'Log Hours', values: h || { date: today(), memberId: (S.team[0] || {}).id, actionId: (opts[0] || {}).value, hours: 4, note: '' },
      fields: [
        { name: 'date', label: 'Date', type: 'date', required: true },
        { name: 'memberId', label: 'Engineer', type: 'select', options: teamOpts() },
        { name: 'actionId', label: 'Action', type: 'select', options: opts, full: true },
        { name: 'hours', label: 'Hours', type: 'number', step: 0.5 },
        { name: 'note', label: 'Work note', full: true }
      ],
      validate: (d) => (d.hours <= 0 ? 'Hours must be greater than zero.' : d.hours > 24 ? 'A single entry cannot exceed 24 hours.' : ''),
      onSubmit: async (d) => { await save('hours', Object.assign({}, editing ? h : { id: uid('hr'), projectId: P().id }, d)); toast('Hours saved.', 'ok'); }
    });
  }

  function blockerForm(b) {
    const editing = !!b;
    const pm = S.team.find((t) => t.role === 'Project Manager');
    openForm({
      title: editing ? 'Edit Blocker' : 'Record Blocker', wide: true,
      values: b || { title: '', description: '', severity: 'Medium', status: 'Open', impact: '', ownerId: (S.team[0] || {}).id, needed: '', actionId: '', raised: today(), target: addDays(today(), 7) },
      fields: [
        { name: 'title', label: 'Blocker', required: true, full: true },
        { name: 'description', label: 'What is blocking progress?', type: 'textarea', full: true, rows: 2 },
        { name: 'severity', label: 'Severity', type: 'select', options: SEVERITY },
        { name: 'status', label: 'Status', type: 'select', options: BLOCKER_STATUS },
        { name: 'ownerId', label: 'Owner', type: 'select', options: teamOpts() },
        { name: 'actionId', label: 'Linked action', type: 'select', options: leafActions().map((a) => ({ value: a.id, label: a.title })), blank: '— None —' },
        { name: 'impact', label: 'Impact on schedule / scope', type: 'textarea', full: true, rows: 2 },
        { name: 'needed', label: `Support needed from ${pm ? pm.name : 'Project Manager'}`, type: 'textarea', full: true, rows: 2 },
        { name: 'raised', label: 'Raised', type: 'date' },
        { name: 'target', label: 'Target resolution', type: 'date' }
      ],
      onSubmit: async (d) => {
        const rec = Object.assign({}, editing ? b : { id: uid('blk'), projectId: P().id, escalatedTo: '', escalatedAt: '' }, d);
        if (rec.status === 'Escalated' && !rec.escalatedTo) { rec.escalatedTo = pm ? pm.name : 'Project Manager'; rec.escalatedAt = today(); }
        await save('blockers', rec);
        toast('Blocker saved.', 'ok');
      }
    });
  }

  function docForm(d0) {
    const editing = !!d0;
    openForm({
      title: editing ? 'Edit Document' : 'Add Document', values: d0 || { title: '', type: DOC_TYPES[0], status: 'Not Started', owner: '', due: addDays(today(), 14), rev: 'A', notes: '' },
      fields: [
        { name: 'title', label: 'Title', required: true, full: true },
        { name: 'type', label: 'Type', type: 'select', options: DOC_TYPES },
        { name: 'status', label: 'Status', type: 'select', options: DOC_STATUS },
        { name: 'owner', label: 'Owner' },
        { name: 'rev', label: 'Revision' },
        { name: 'due', label: 'Due date', type: 'date' },
        { name: 'notes', label: 'Notes', type: 'textarea', full: true, rows: 2 }
      ],
      onSubmit: async (d) => { await save('docs', Object.assign({}, editing ? d0 : { id: uid('doc'), projectId: P().id }, d)); toast('Document saved.', 'ok'); }
    });
  }

  function noteForm(n) {
    const editing = !!n;
    openForm({
      title: editing ? 'Edit Note' : 'Add Troubleshooting Note', wide: true, values: n || { title: '', category: NOTE_CATS[0], body: '', date: today() },
      fields: [
        { name: 'title', label: 'Title', required: true, full: true },
        { name: 'category', label: 'Category', type: 'select', options: NOTE_CATS },
        { name: 'date', label: 'Date', type: 'date' },
        { name: 'body', label: 'Symptoms, cause, fix, SQL / config snippet', type: 'textarea', rows: 9, full: true }
      ],
      onSubmit: async (d) => { await save('notes', Object.assign({}, editing ? n : { id: uid('note'), projectId: P().id }, d)); toast('Note saved.', 'ok'); }
    });
  }

  function qaForm(cat) {
    openForm({
      title: `Add ${cat} item`, values: { text: '' },
      fields: [{ name: 'text', label: 'Checklist item', required: true, full: true }],
      onSubmit: async (d) => { await save('qhse', { id: uid('qa'), projectId: P().id, category: cat, text: d.text, checked: false, ref: cat === 'QHSE' ? 'Annexure-SCT-HR-001' : '' }); }
    });
  }

  /* =====================================================================
     9. Reports, export & import
     ===================================================================== */
  function download(name, text, type = 'application/json') {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function projectBundle(pid) {
    const acts = S.actions.filter((a) => a.projectId === pid);
    const hrs = S.hours.filter((h) => h.projectId === pid);
    const memberIds = new Set(acts.map((a) => a.assigneeId).concat(hrs.map((h) => h.memberId)));
    return {
      projects: S.projects.filter((p) => p.id === pid), actions: acts, bom: S.bom.filter((b) => b.projectId === pid),
      team: S.team.filter((t) => memberIds.has(t.id)), hours: hrs, blockers: S.blockers.filter((b) => b.projectId === pid),
      qhse: S.qhse.filter((q) => q.projectId === pid), docs: S.docs.filter((d) => d.projectId === pid), notes: S.notes.filter((n) => n.projectId === pid)
    };
  }

  function exportReport() {
    const p = P();
    if (!p) return;
    const payload = { kind: 'scopetracker-report', app: 'ScopeTracker Pro', version: 1, exportedAt: new Date().toISOString(), metrics: metrics(), data: projectBundle(p.id) };
    download(`scopetracker-report-${slug(p.name).slice(0, 40)}-${today()}.json`, JSON.stringify(payload, null, 2));
    toast('Project report exported.', 'ok');
  }

  function exportBackup() {
    const payload = { kind: 'scopetracker-backup', app: 'ScopeTracker Pro', version: 1, exportedAt: new Date().toISOString(), data: S };
    download(`scopetracker-backup-${today()}.json`, JSON.stringify(payload, null, 2));
    toast('Full backup exported.', 'ok');
  }

  async function importJSON(file) {
    try {
      const obj = JSON.parse(await file.text());
      const data = obj && obj.data && typeof obj.data === 'object' ? obj.data : obj;
      if (!data || !Array.isArray(data.projects)) throw new Error('No projects found in file.');
      if (obj.kind === 'scopetracker-report') {
        if (!confirmBox(`Merge report for ${data.projects.length} project(s) into this workspace? Existing records with the same ID will be overwritten.`)) return;
        for (const s of STORES) for (const r of data[s] || []) if (r && r.id) await save(s, r);
      } else {
        if (!confirmBox('Replace ALL current data with this backup? This cannot be undone.')) return;
        await replaceAll(data);
      }
      if (!S.projects.some((p) => p.id === UI.projectId)) UI.projectId = (S.projects[0] || {}).id || null;
      render();
      toast('Import complete.', 'ok');
    } catch (e) {
      console.error(e);
      toast(`Import failed: ${e.message}`, 'error');
    }
  }

  function buildReport() {
    const p = P();
    if (!p) return '';
    const m = metrics();
    const acts = projActions();
    const rows = treeRows(acts);
    const bom = S.bom.filter((b) => b.projectId === p.id);
    const blk = S.blockers.filter((b) => b.projectId === p.id && b.status !== 'Resolved');
    return `<div class="report">
      <header><h1>Executive Status Summary</h1><p>${esc(p.name)}</p><p>${esc(p.client)} · ${esc(p.location || '')} · Report date ${fmtDate(today())}</p><p>Prepared by SCADA Engineering — Al Gurg Automation and Controls, Dubai, U.A.E.</p></header>
      <h2>Key indicators</h2>
      <table><tbody>
        <tr><th>Scope completion</th><td>${m.scope}% (${m.doneLeaves}/${m.leaves} actions)</td><th>Deadline</th><td>${fmtDate(p.deadline)}</td></tr>
        <tr><th>Hours</th><td>${m.logged} of ${m.est} h</td><th>Budget</th><td>${aed(m.spend)} of ${aed(m.budget)} (${Math.round(m.budgetPct)}%)</td></tr>
        <tr><th>BOM procurement</th><td>${m.bomPct}%</td><th>QHSE compliance</th><td>${m.qhsePct}% (${m.qhseChecked}/${m.qhseTotal})</td></tr>
        <tr><th>Active blockers</th><td>${m.blockersActive}</td><th>FAT / SAT readiness</th><td>${m.qaPct}%</td></tr>
      </tbody></table>
      <h2>Objective & scope</h2><p>${esc(p.objective)}</p><p>${esc(p.scope)}</p>
      <h2>Work breakdown & status</h2>
      <table><thead><tr><th>Action</th><th>Assignee</th><th>Status</th><th>%</th><th>Timeframe</th></tr></thead><tbody>
      ${rows.map(({ a, level }) => `<tr><td style="padding-left:${level * 18 + 6}px">${level ? '' : '<b>'}${esc(a.title)}${level ? '' : '</b>'}</td><td>${esc((member(a.assigneeId) || {}).name || '—')}</td><td>${esc(effStatus(a))}</td><td>${effProgress(a)}</td><td>${fmtShort(a.start)} → ${fmtShort(a.end)}</td></tr>`).join('')}</tbody></table>
      <h2>Open blockers & escalations</h2>
      ${blk.length ? `<table><thead><tr><th>Blocker</th><th>Severity</th><th>Status</th><th>Impact</th><th>Support needed</th></tr></thead><tbody>${blk.map((b) => `<tr><td>${esc(b.title)}</td><td>${esc(b.severity)}</td><td>${esc(b.status)}</td><td>${esc(b.impact)}</td><td>${esc(b.needed)}</td></tr>`).join('')}</tbody></table>` : '<p>No open blockers.</p>'}
      <h2>Procurement (BOM)</h2>
      <table><thead><tr><th>Item</th><th>Qty</th><th>Total AED</th><th>Status</th><th>Lead</th></tr></thead><tbody>${bom.map((b) => `<tr><td>${esc(b.name)}</td><td>${b.qty}</td><td>${bomTotal(b).toLocaleString('en-US')}</td><td>${esc(b.status)}</td><td>${b.leadDays || 0} d</td></tr>`).join('')}</tbody><tfoot><tr><th colspan="2">Total</th><th>${m.bomEstimate.toLocaleString('en-US')}</th><th colspan="2"></th></tr></tfoot></table>
      <h2>QHSE (Annexure-SCT-HR-001) & QA</h2>
      <ul>${S.qhse.filter((q) => q.projectId === p.id).map((q) => `<li>${q.checked ? '☑' : '☐'} [${esc(q.category)}] ${esc(q.text)}</li>`).join('')}</ul>
    </div>`;
  }

  function printReport() {
    if (!P()) return;
    $('#printReport').innerHTML = buildReport();
    document.body.classList.add('printing');
    const done = () => { document.body.classList.remove('printing'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => { try { window.print(); } catch (e) { done(); } }, 60);
  }

  /* =====================================================================
     10. Event handlers
     ===================================================================== */
  const byId = (store, id) => S[store].find((r) => r.id === id);

  const H = {
    'modal-close': () => closeModal(),
    'new-project': () => projectForm(null),
    'edit-project': () => projectForm(P()),
    'delete-project': async () => {
      const p = P();
      if (!p || !confirmBox(`Delete "${p.name}" and all of its actions, BOM, hours, blockers and notes?`)) return;
      for (const s of ['actions', 'bom', 'hours', 'blockers', 'qhse', 'docs', 'notes']) for (const r of S[s].filter((x) => x.projectId === p.id)) await remove(s, r.id);
      await remove('projects', p.id);
      UI.projectId = (S.projects[0] || {}).id || null;
      try { localStorage.setItem(LS_PROJECT, UI.projectId || ''); } catch (e) { /* ignore */ }
      render(); toast('Project deleted.');
    },
    'wbs-template': async () => {
      const p = P();
      if (!p) return;
      if (projActions().length && !confirmBox('This project already has actions. Append the standard SCADA WBS template phases?')) return;
      const list = wbsTemplate(p, S.team);
      for (const a of list) await save('actions', a);
      render(); toast(`SCADA WBS template added (${list.length} actions).`, 'ok');
    },
    'new-action': () => actionForm(null),
    'edit-action': (d) => actionForm(byId('actions', d.id)),
    decompose: (d) => decomposeForm(byId('actions', d.id)),
    'delete-action': async (d) => {
      const a = byId('actions', d.id);
      if (!a) return;
      const ids = [a.id].concat(kidsOf(a.id).map((k) => k.id));
      if (!confirmBox(`Delete "${a.title}"${ids.length > 1 ? ` and its ${ids.length - 1} sub-action(s)` : ''}? Logged hours on these actions are removed too.`)) return;
      for (const h of S.hours.filter((x) => ids.includes(x.actionId))) await remove('hours', h.id);
      for (const b of S.blockers.filter((x) => ids.includes(x.actionId))) await save('blockers', Object.assign({}, b, { actionId: '' }));
      for (const id of ids) await remove('actions', id);
      render(); toast('Action deleted.');
    },
    layout: (d) => { UI.layout = d.v; render(); },
    'clear-filters': () => { UI.phase = ''; UI.assignee = ''; UI.status = ''; UI.bomStatus = ''; UI.noteCat = ''; UI.q = ''; const s = $('#globalSearch'); if (s) s.value = ''; render(); },
    'new-bom': () => bomForm(null),
    'edit-bom': (d) => bomForm(byId('bom', d.id)),
    'delete-bom': async (d) => { if (confirmBox('Delete this BOM item?')) { await remove('bom', d.id); render(); } },
    'new-member': () => memberForm(null),
    'edit-member': (d) => memberForm(byId('team', d.id)),
    'delete-member': async (d) => {
      const t = byId('team', d.id);
      if (!t || !confirmBox(`Remove ${t.name}? Their actions become unassigned; logged hours are kept without a name.`)) return;
      for (const a of S.actions.filter((x) => x.assigneeId === t.id)) await save('actions', Object.assign({}, a, { assigneeId: '' }));
      await remove('team', t.id); render();
    },
    'log-hours': () => hoursForm(null),
    'edit-hours': (d) => hoursForm(byId('hours', d.id)),
    'delete-hours': async (d) => { if (confirmBox('Delete this hours entry?')) { await remove('hours', d.id); render(); } },
    'new-blocker': () => blockerForm(null),
    'edit-blocker': (d) => blockerForm(byId('blockers', d.id)),
    'delete-blocker': async (d) => { if (confirmBox('Delete this blocker?')) { await remove('blockers', d.id); render(); } },
    'escalate-blocker': async (d) => {
      const b = byId('blockers', d.id);
      const pm = S.team.find((t) => t.role === 'Project Manager');
      await save('blockers', Object.assign({}, b, { status: 'Escalated', escalatedTo: pm ? pm.name : 'Project Manager', escalatedAt: today() }));
      render(); toast(`Escalated to ${pm ? pm.name : 'the Project Manager'}.`, 'ok');
    },
    'resolve-blocker': async (d) => { await save('blockers', Object.assign({}, byId('blockers', d.id), { status: 'Resolved' })); render(); toast('Blocker resolved.', 'ok'); },
    'reopen-blocker': async (d) => { await save('blockers', Object.assign({}, byId('blockers', d.id), { status: 'Open' })); render(); },
    'copy-escalation': async (d) => {
      const b = byId('blockers', d.id);
      const p = P();
      const o = member(b.ownerId);
      const text = `ESCALATION — ${p.name}\nBlocker: ${b.title}\nSeverity: ${b.severity}\nWhat: ${b.description}\nImpact: ${b.impact}\nOwner: ${o ? o.name : '—'}\nSupport needed: ${b.needed}\nTarget resolution: ${fmtDate(b.target)}`;
      try { await navigator.clipboard.writeText(text); toast('Escalation note copied.', 'ok'); } catch (e) { download('escalation-note.txt', text, 'text/plain'); }
    },
    'new-doc': () => docForm(null),
    'edit-doc': (d) => docForm(byId('docs', d.id)),
    'delete-doc': async (d) => { if (confirmBox('Delete this document record?')) { await remove('docs', d.id); render(); } },
    'new-qa': (d) => qaForm(d.cat),
    'delete-qa': async (d) => { await remove('qhse', d.id); render(); },
    'load-qa-template': async () => { for (const q of qaTemplate(P().id)) await save('qhse', q); render(); },
    'new-note': () => noteForm(null),
    'edit-note': (d) => noteForm(byId('notes', d.id)),
    'delete-note': async (d) => { if (confirmBox('Delete this note?')) { await remove('notes', d.id); render(); } },
    'export-report': () => exportReport(),
    'export-backup': () => exportBackup(),
    'print-report': () => printReport(),
    'import-json': () => $('#importFile').click(),
    'reset-demo': async () => {
      if (!confirmBox('Replace all data with the demo workspace? Your current data will be lost.')) return;
      await replaceAll(buildSeed());
      UI.projectId = S.projects[0].id;
      try { localStorage.setItem(LS_PROJECT, UI.projectId); } catch (e) { /* ignore */ }
      render(); toast('Demo data restored.', 'ok');
    }
  };

  const C = {
    filter: (d, el) => { UI[d.key] = el.value; render(); },
    'action-status': async (d, el) => {
      const a = byId('actions', d.id);
      const rec = Object.assign({}, a, { status: el.value });
      if (rec.status === 'Completed') rec.progress = 100;
      else if (a.status === 'Completed' && rec.progress === 100) rec.progress = 90;
      await save('actions', rec); render();
      if (rec.status === 'Blocked') toast('Marked blocked — record it in the Blockers & Escalation Log.');
    },
    progress: async (d, el) => {
      const a = byId('actions', d.id);
      const v = Number(el.value);
      const rec = Object.assign({}, a, { progress: v });
      if (v === 100) rec.status = 'Completed';
      else if (a.status === 'Completed') rec.status = 'In Progress';
      else if (v > 0 && a.status === 'Backlog') rec.status = 'In Progress';
      await save('actions', rec); render();
    },
    'bom-status': async (d, el) => { await save('bom', Object.assign({}, byId('bom', d.id), { status: el.value })); render(); },
    'doc-status': async (d, el) => { await save('docs', Object.assign({}, byId('docs', d.id), { status: el.value })); render(); },
    'qa-toggle': async (d, el) => { await save('qhse', Object.assign({}, byId('qhse', d.id), { checked: el.checked })); render(); }
  };

  function bindEvents() {
    document.addEventListener('click', async (e) => {
      if (e.target.classList && e.target.classList.contains('modal-backdrop')) { closeModal(); return; }
      const nav = e.target.closest('.nav button[data-view]');
      if (nav) { setView(nav.dataset.view); return; }
      const el = e.target.closest('[data-act]');
      if (!el) return;
      const fn = H[el.dataset.act];
      if (fn) { const menu = $('#dataMenu'); if (menu) menu.open = false; await fn(el.dataset, el); }
    });
    document.addEventListener('change', async (e) => {
      const el = e.target.closest('[data-change]');
      if (!el) return;
      const fn = C[el.dataset.change];
      if (fn) await fn(el.dataset, el);
    });
    document.addEventListener('input', (e) => {
      const el = e.target;
      if (el.matches && el.matches('input[type=range][data-input]')) {
        const o = el.closest('.slider') && el.closest('.slider').querySelector('[data-out]');
        if (o) o.textContent = `${el.value}%`;
      } else if (el.matches && el.matches('#entityForm input[type=range]')) {
        const o = el.parentElement.querySelector('output');
        if (o) o.textContent = `${el.value}%`;
      }
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#modalRoot').firstChild) closeModal(); });
    document.addEventListener('click', (e) => {
      const menu = $('#dataMenu');
      if (menu && menu.open && !menu.contains(e.target)) menu.open = false;
    });
    $('#projectSwitch').addEventListener('change', (e) => {
      UI.projectId = e.target.value || null;
      try { localStorage.setItem(LS_PROJECT, UI.projectId || ''); } catch (err) { /* ignore */ }
      render();
    });
    $('#globalSearch').addEventListener('input', (e) => { UI.q = e.target.value.trim(); render(); });
    $('#importFile').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) importJSON(f); e.target.value = ''; });
    window.addEventListener('hashchange', () => { const v = location.hash.replace('#', ''); if (TITLES[v] && v !== UI.view) setView(v, false); });
  }

  /* =====================================================================
     11. PWA: network, install, service worker, shortcuts
     ===================================================================== */
  function updateNet() {
    const on = navigator.onLine;
    ['#netState', '#netStateTop'].forEach((sel) => {
      const el = $(sel);
      if (!el) return;
      el.classList.toggle('offline', !on);
      const t = el.querySelector('.net-text');
      if (t) t.textContent = on ? 'Online' : 'Offline · local data';
    });
  }

  let deferredPrompt = null;
  function setupInstall() {
    const banner = $('#installBanner');
    const dismissed = (() => { try { return localStorage.getItem(LS_INSTALL_DISMISS) === '1'; } catch (e) { return false; } })();
    const standalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    const doInstall = async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      try { await deferredPrompt.userChoice; } catch (e) { /* ignore */ }
      deferredPrompt = null;
      banner.hidden = true; $('#installBtn').hidden = true;
    };
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      $('#installBtn').hidden = false;
      if (!dismissed) banner.hidden = false;
    });
    window.addEventListener('appinstalled', () => { banner.hidden = true; $('#installBtn').hidden = true; toast('ScopeTracker Pro installed.', 'ok'); });
    $('#installBtn').addEventListener('click', doInstall);
    $('#installBannerBtn').addEventListener('click', doInstall);
    $('#installDismiss').addEventListener('click', () => { banner.hidden = true; try { localStorage.setItem(LS_INSTALL_DISMISS, '1'); } catch (e) { /* ignore */ } });
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
    if (ios && !standalone && !dismissed) {
      $('#installTitle').textContent = 'Add to Home Screen';
      $('#installText').textContent = 'Tap the Share icon, then "Add to Home Screen" to install ScopeTracker Pro.';
      $('#installBannerBtn').hidden = true;
      banner.hidden = false;
    }
  }

  function registerSW() {
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
    const toastEl = $('#updateToast');
    const show = (reg) => {
      toastEl.hidden = false;
      $('#updateBtn').onclick = () => { if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' }); };
      $('#updateDismiss').onclick = () => { toastEl.hidden = true; };
    };
    navigator.serviceWorker.register('sw.js').then((reg) => {
      if (reg.waiting && navigator.serviceWorker.controller) show(reg);
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) show(reg); });
      });
      setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
    }).catch((err) => console.warn('Service worker registration failed', err));
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (refreshing) return; refreshing = true; location.reload(); });
  }

  function handleShortcuts() {
    const params = new URLSearchParams(location.search);
    const act = params.get('action');
    if (!act) return;
    try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) { /* ignore */ }
    if (!P()) return;
    if (act === 'new-task') { setView('actions'); actionForm(null); }
    else if (act === 'bom') { setView('bom'); }
    else if (act === 'new-blocker') { setView('resources'); blockerForm(null); }
  }

  /* =====================================================================
     12. Boot
     ===================================================================== */
  async function init() {
    db = new ScopeTrackerDB();
    await db.open();
    try { await loadAll(); } catch (e) { console.error('Load failed', e); db.useLS = true; await loadAll(); }
    let stored = '';
    try { stored = localStorage.getItem(LS_PROJECT) || ''; } catch (e) { /* ignore */ }
    UI.projectId = S.projects.some((p) => p.id === stored) ? stored : (S.projects[0] || {}).id || null;
    const hv = location.hash.replace('#', '');
    if (TITLES[hv]) UI.view = hv;
    bindEvents();
    updateNet();
    window.addEventListener('online', updateNet);
    window.addEventListener('offline', updateNet);
    setupInstall();
    render();
    handleShortcuts();
    registerSW();
    if (navigator.storage && navigator.storage.persist) { navigator.storage.persist().catch(() => {}); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  window.ScopeTracker = { state: S, ui: UI, metrics, render, setView };
})();
