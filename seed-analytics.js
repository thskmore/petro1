const { openDatabase } = require('./sqlite-adapter');

async function seed() {
  const db = await openDatabase('./data.db');
  const existing = db.prepare('select count(*) as c from duties where d < "2026-10-08"').get().c;
  if (existing > 0) {
    console.log('Already seeded');
    return;
  }

  console.log('Seeding historical duties and expenses for analytics...');
  
  const workers = [3, 4, 5]; // Vikram, Yedage, Bira
  const nozzles = [
    { id: '1791451493538', name: 'N1 HSD', fuel: 'Diesel (HSD)', rate: 99, baseVol: 450 },
    { id: '1791525303738', name: 'N6', fuel: 'Petrol (MS)', rate: 112, baseVol: 320 },
    { id: '1791525247291', name: 'N4 Power', fuel: 'Power petrol', rate: 122, baseVol: 80 }
  ];

  const shiftExpCats = [
    { cat: 'Tea and food', note: 'Staff tea & breakfast', min: 40, max: 120, chance: 0.8 },
    { cat: 'Generator fuel', note: 'Diesel for power back-up', min: 250, max: 450, chance: 0.25 },
    { cat: 'Cleaning supplies', note: 'Wiper and soap', min: 80, max: 200, chance: 0.15 },
    { cat: 'Stationery & rolls', note: 'POS receipt rolls', min: 90, max: 180, chance: 0.1 }
  ];

  // Generate days from 2026-08-01 to 2026-10-07
  const startDate = new Date('2026-08-01T06:00:00Z');
  const endDate = new Date('2026-10-07T06:00:00Z');
  
  // Track nozzle meter readings backward or forward
  const meters = {
    '1791451493538': 10000,
    '1791525303738': 8000,
    '1791525247291': 3000
  };

  const insertDuty = db.prepare(`
    insert into duties(worker_id, d, shift, status, cash, upi, card, note, started, submitted, closed_by, closed_at, pay_json, stock_done, assigned_by)
    values(?, ?, ?, 'closed', ?, ?, ?, '', ?, ?, 2, ?, ?, 1, 2)
  `);
  const insertLine = db.prepare(`
    insert into duty_lines(duty_id, nozzle_id, opening, closing, testing, rate)
    values(?, ?, ?, ?, ?, ?)
  `);
  const insertExp = db.prepare(`
    insert into duty_expenses(duty_id, cat, note, amount)
    values(?, ?, ?, ?)
  `);

  let cur = new Date(startDate);
  let dutyIdx = 0;

  while (cur <= endDate) {
    const dStr = cur.toISOString().slice(0, 10);
    const dayOfWeek = cur.getDay(); // 0 is Sunday
    // weekend factor
    const weekendMultiplier = (dayOfWeek === 0 || dayOfWeek === 6) ? 1.25 : 1.0;

    for (const shift of ['Morning', 'Evening']) {
      dutyIdx++;
      const workerId = workers[dutyIdx % workers.length];
      const started = Math.floor(cur.getTime() / 1000) + (shift === 'Morning' ? 6 * 3600 : 16 * 3600);
      const submitted = started + 8 * 3600;
      const closedAt = submitted + 300;

      // Create lines
      let shiftTotal = 0;
      const linesData = [];
      for (const nz of nozzles) {
        // variance
        const variance = 0.85 + Math.random() * 0.35;
        const litres = Math.round(nz.baseVol * weekendMultiplier * variance * 10) / 10;
        const openVal = meters[nz.id];
        const closeVal = Math.round((openVal + litres) * 100) / 100;
        meters[nz.id] = closeVal;

        const lineAmount = Math.round(litres * nz.rate);
        shiftTotal += lineAmount;
        linesData.push({
          nozzle_id: nz.id,
          opening: openVal,
          closing: closeVal,
          testing: (dutyIdx % 7 === 0) ? 5 : 0,
          rate: nz.rate
        });
      }

      // Collections
      const cash = Math.round(shiftTotal * 0.65);
      const upi = Math.round(shiftTotal * 0.25);
      const card = shiftTotal - cash - upi;
      const payJson = JSON.stringify({ cash, upi, card });

      const dRes = insertDuty.run(workerId, dStr, shift, cash, upi, card, started, submitted, closedAt, payJson);
      const dutyId = dRes.lastInsertRowid;

      for (const ld of linesData) {
        insertLine.run(dutyId, ld.nozzle_id, ld.opening, ld.closing, ld.testing, ld.rate);
      }

      // Shift expenses
      for (const ec of shiftExpCats) {
        if (Math.random() < ec.chance) {
          const amt = Math.round(ec.min + Math.random() * (ec.max - ec.min));
          insertExp.run(dutyId, ec.cat, ec.note, amt);
        }
      }
    }

    cur.setDate(cur.getDate() + 1);
  }

  // Also seed realistic cash book entries into state S.bk
  const stateRow = db.prepare('select id, ver, json from state where id=1').get();
  if (stateRow) {
    const state = JSON.parse(stateRow.json);
    state.bk = state.bk || [];
    if (state.bk.length === 0) {
      const bookExpenses = [
        { d: '2026-08-05', t: 'out', acct: 'Bank', cat: 'Electricity', n: 'MSEDCL Commercial Power Bill (July)', a: 8750 },
        { d: '2026-08-10', t: 'out', acct: 'Bank', cat: 'Salary', n: 'Staff Salary - August', a: 36000 },
        { d: '2026-08-18', t: 'out', acct: 'Bank', cat: 'Repairs', n: 'Nozzle calibration and meter stamping', a: 4200 },
        { d: '2026-08-25', t: 'out', acct: 'Cash', cat: 'Transport', n: 'Lube oil transport freight', a: 1600 },
        { d: '2026-09-04', t: 'out', acct: 'Bank', cat: 'Electricity', n: 'MSEDCL Commercial Power Bill (August)', a: 9400 },
        { d: '2026-09-10', t: 'out', acct: 'Bank', cat: 'Salary', n: 'Staff Salary - September', a: 36000 },
        { d: '2026-09-15', t: 'out', acct: 'Cash', cat: 'Repairs', n: 'Submersible fuel pump motor servicing', a: 6800 },
        { d: '2026-09-22', t: 'out', acct: 'Bank', cat: 'Other', n: 'Annual Petroleum license & safety inspection', a: 7500 },
        { d: '2026-10-04', t: 'out', acct: 'Bank', cat: 'Electricity', n: 'MSEDCL Commercial Power Bill (September)', a: 9150 },
        { d: '2026-10-06', t: 'out', acct: 'Cash', cat: 'Repairs', n: 'Air pressure compressor belt & gauge replacement', a: 2400 }
      ];
      let bkId = Date.now();
      for (const be of bookExpenses) {
        state.bk.push({ id: ++bkId, ...be });
      }
      db.prepare('update state set json=? where id=1').run(JSON.stringify(state));
    }
  }

  await db.saveNow();
  console.log(`Seeding complete: generated ${dutyIdx} duties.`);
}

seed().then(() => process.exit(0)).catch(e => {
  console.error(e);
  process.exit(1);
});
