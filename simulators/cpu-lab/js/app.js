/* CPU Lab — educational assembly CPU simulator with fetch-decode-execute pipeline. */
(function () {
  'use strict';

  window.addEventListener('error', (e) => {
    const box = document.getElementById('errBox');
    if (box) { box.style.display = 'block'; box.textContent = 'Something went wrong:\n' + (e.message || String(e)); }
  });

  /* ---------- Assembler ---------- */
  const OPCODES = {
    MOV: 0, ADD: 1, SUB: 2, MUL: 3, DIV: 4,
    CMP: 5, JMP: 6, JE: 7, JNE: 8, JG: 9, JGE: 10, JL: 11, JLE: 12,
    LOAD: 13, STORE: 14, OUT: 15, HLT: 16, NOP: 17,
  };
  const OPCODE_NAMES = Object.fromEntries(Object.entries(OPCODES).map(([k, v]) => [v, k]));
  const REG_RE = /^(R[0-7])$/;
  const IMM_RE = /^(-?\d+)$/;
  const LABEL_RE = /^[a-zA-Z_]\w*$/;

  function parseLine(raw, lineNo) {
    let s = raw.replace(/;.*$/, '').trim();
    if (!s) return null;
    let label = null;
    const lb = s.match(/^([a-zA-Z_]\w*):\s*(.*)$/);
    if (lb) { label = lb[1].toLowerCase(); s = lb[2].trim(); }
    if (!s) return label ? { type: 'label', label, line: lineNo } : null;
    const parts = s.split(/\s+/);
    const op = parts[0].toUpperCase();
    const operands = parts.slice(1).join(' ').split(/\s*,\s*/).map((o) => o.trim()).filter((o) => o !== '');
    if (!OPCODES.hasOwnProperty(op)) return { type: 'error', message: 'Unknown instruction "' + op + '"', line: lineNo };
    return { type: 'instr', opcode: op, operands, label, line: lineNo };
  }

  function assemble(code) {
    const lines = code.split(/\r?\n/);
    const parsed = [];
    for (let i = 0; i < lines.length; i++) {
      const r = parseLine(lines[i], i + 1);
      if (r) parsed.push(r);
    }
    const labels = {};
    let addr = 0;
    for (const p of parsed) {
      if (p.type === 'label') { labels[p.label] = addr; } else { addr++; }
    }
    const instructions = [];
    for (const p of parsed) {
      if (p.type === 'label') continue;
      if (p.type === 'error') return { ok: false, error: 'Line ' + p.line + ': ' + p.message };
      const op = OPCODES[p.opcode];
      const resolved = [];
      for (const o of p.operands) {
        if (REG_RE.test(o)) resolved.push({ type: 'reg', value: o.toUpperCase() });
        else if (IMM_RE.test(o)) resolved.push({ type: 'imm', value: parseInt(o, 10) });
        else if (LABEL_RE.test(o)) {
          const low = o.toLowerCase();
          if (!labels.hasOwnProperty(low)) return { ok: false, error: 'Line ' + p.line + ': unknown label "' + o + '"' };
          resolved.push({ type: 'label', value: low, address: labels[low] });
        } else return { ok: false, error: 'Line ' + p.line + ': invalid operand "' + o + '"' };
      }
      instructions.push({ opcode: op, operands: resolved, line: p.line, raw: p.opcode + ' ' + p.operands.join(', ') });
    }
    return { ok: true, instructions, labels };
  }

  /* ---------- CPU State ---------- */
  function createCPU() {
    return {
      regs: new Array(8).fill(0),
      mem: new Array(128).fill(0),
      pc: 0,
      ir: null,
      flags: { Z: false, N: false, C: false },
      stage: 'idle',
      cycle: 0,
      running: false,
      halted: false,
      error: null,
      output: [],
      memAccess: null,
    };
  }

  /* ---------- Pipeline engine ---------- */
  function executeStage(cpu, prog) {
    if (cpu.halted || cpu.error) return 'halted';
    const stage = cpu.stage;
    if (stage === 'idle') { cpu.stage = 'fetch'; return 'fetch'; }
    if (stage === 'fetch') {
      if (cpu.pc < 0 || cpu.pc >= prog.length) { cpu.error = 'PC out of bounds (' + cpu.pc + ')'; cpu.stage = 'idle'; return 'error'; }
      cpu.ir = prog[cpu.pc];
      cpu.stage = 'decode';
      return 'decode';
    }
    if (stage === 'decode') {
      cpu.stage = 'execute';
      return 'execute';
    }
    if (stage === 'execute') {
      const ir = cpu.ir;
      if (!ir) { cpu.stage = 'idle'; return 'idle'; }
      const op = ir.opcode;
      const ops = ir.operands;
      let nextPc = cpu.pc + 1;
      let jumpTarget = null;
      let memAddr = null;
      let memVal = null;
      let err = null;

      switch (op) {
        case OPCODES.MOV: {
          const dst = ops[0].value;
          const src = ops[1];
          cpu.regs[regIdx(dst)] = src.type === 'imm' ? src.value : cpu.regs[regIdx(src.value)];
          break;
        }
        case OPCODES.ADD: {
          const d = regIdx(ops[0].value);
          const s = cpu.regs[regIdx(ops[1].value)];
          const r = cpu.regs[d] + s;
          cpu.flags.C = r > 255 || r < -255;
          cpu.regs[d] = r;
          break;
        }
        case OPCODES.SUB: {
          const d = regIdx(ops[0].value);
          const s = cpu.regs[regIdx(ops[1].value)];
          const r = cpu.regs[d] - s;
          cpu.flags.C = r < -255;
          cpu.regs[d] = r;
          break;
        }
        case OPCODES.MUL: {
          const d = regIdx(ops[0].value);
          cpu.regs[d] = cpu.regs[d] * cpu.regs[regIdx(ops[1].value)];
          break;
        }
        case OPCODES.DIV: {
          const d = regIdx(ops[0].value);
          const s = cpu.regs[regIdx(ops[1].value)];
          if (s === 0) { err = 'Division by zero (line ' + ir.line + ')'; }
          else { cpu.regs[d] = Math.trunc(cpu.regs[d] / s); }
          break;
        }
        case OPCODES.CMP: {
          const a = cpu.regs[regIdx(ops[0].value)];
          const b = cpu.regs[regIdx(ops[1].value)];
          const diff = a - b;
          cpu.flags.Z = diff === 0;
          cpu.flags.N = diff < 0;
          cpu.flags.C = diff < -255 || diff > 255;
          break;
        }
        case OPCODES.JMP: { jumpTarget = ops[0].address; break; }
        case OPCODES.JE:  if (cpu.flags.Z) jumpTarget = ops[0].address; break;
        case OPCODES.JNE: if (!cpu.flags.Z) jumpTarget = ops[0].address; break;
        case OPCODES.JG:  if (!cpu.flags.Z && !cpu.flags.N) jumpTarget = ops[0].address; break;
        case OPCODES.JGE: if (!cpu.flags.N) jumpTarget = ops[0].address; break;
        case OPCODES.JL:  if (cpu.flags.N) jumpTarget = ops[0].address; break;
        case OPCODES.JLE: if (cpu.flags.N || cpu.flags.Z) jumpTarget = ops[0].address; break;
        case OPCODES.LOAD: {
          memAddr = ops[1].value;
          cpu.regs[regIdx(ops[0].value)] = cpu.mem[memAddr];
          break;
        }
        case OPCODES.STORE: {
          memAddr = ops[1].value;
          cpu.mem[memAddr] = cpu.regs[regIdx(ops[0].value)];
          break;
        }
        case OPCODES.OUT: {
          const v = cpu.regs[regIdx(ops[0].value)];
          cpu.output.push(String(v));
          break;
        }
        case OPCODES.HLT: {
          cpu.halted = true;
          cpu.stage = 'idle';
          return 'halted';
        }
        case OPCODES.NOP: break;
      }

      if (err) { cpu.error = err; cpu.stage = 'idle'; return 'error'; }
      if (jumpTarget !== null) nextPc = jumpTarget;
      cpu.pc = nextPc;
      cpu.stage = 'idle';
      return 'execute';
    }
    cpu.stage = 'idle';
    return 'idle';
  }

  function regIdx(r) { return parseInt(r.slice(1), 10); }

  /* ---------- Example programs ---------- */
  const EXAMPLES = {
    add: '; Add two numbers\nMOV R0, 5\nMOV R1, 3\nADD R0, R1\nOUT R0\nHLT',
    loop: '; Countdown from 5 to 0\nMOV R0, 5\nloop:\n  OUT R0\n  SUB R0, 1\n  CMP R0, 0\n  JNE loop\nHLT',
    max: '; Find max of 3 numbers\nMOV R0, 10\nMOV R1, 25\nMOV R2, 7\nCMP R0, R1\nJG a\nMOV R0, R1\na:\nCMP R0, R2\nJG b\nMOV R0, R2\nb:\nOUT R0\nHLT',
    fib: '; Fibonacci: first 6 numbers (0 1 1 2 3 5)\nMOV R0, 0\nMOV R1, 1\nMOV R2, 6\nOUT R0\nOUT R1\nloop:\n  ADD R0, R1\n  OUT R0\n  SUB R2, 1\n  CMP R2, 2\n  JG loop\nHLT',
    mem: '; Memory copy: Mem[10]=42, Mem[11]=99, copy to R0,R1 then OUT\nMOV R0, 0\nLOAD R0, 10\nOUT R0\nLOAD R1, 11\nOUT R1\nHLT',
  };

  /* ---------- UI ---------- */
  const editor = document.getElementById('codeEditor');
  const lineNums = document.getElementById('lineNums');
  const btnRun = document.getElementById('btnRun');
  const btnStep = document.getElementById('btnStep');
  const btnReset = document.getElementById('btnReset');
  const speedSlider = document.getElementById('speedSlider');
  const speedVal = document.getElementById('speedVal');
  const exampleSelect = document.getElementById('exampleSelect');
  const pcDisplay = document.getElementById('pcDisplay');
  const irDisplay = document.getElementById('irDisplay');
  const regsPanel = document.getElementById('regsPanel');
  const memPanel = document.getElementById('memPanel');
  const consolePanel = document.getElementById('consolePanel');
  const statusText = document.getElementById('statusText');
  const cycleReadout = document.getElementById('cycleReadout');
  const stageFetch = document.getElementById('stageFetch');
  const stageDecode = document.getElementById('stageDecode');
  const stageExecute = document.getElementById('stageExecute');
  const blockPC = document.getElementById('blockPC');
  const blockIR = document.getElementById('blockIR');
  const blockRegs = document.getElementById('blockRegs');
  const blockFlags = document.getElementById('blockFlags');
  const blockALU = document.getElementById('blockALU');
  const blockMem = document.getElementById('blockMem');
  const blockCU = document.getElementById('blockCU');
  const flagZ = document.getElementById('flagZ');
  const flagN = document.getElementById('flagN');
  const flagC = document.getElementById('flagC');

  const cpu = createCPU();
  let prog = [];
  let runTimer = null;
  let lastStage = null;

  function track(name, params) {
    if (window.EduLift) window.EduLift.track(name, Object.assign({ simulator: 'cpu-lab' }, params || {}));
  }

  function updateLineNums() {
    const lines = editor.value.split('\n');
    let html = '';
    for (let i = 0; i < lines.length; i++) html += '<span class="ln">' + (i + 1) + '</span>';
    lineNums.innerHTML = html;
  }

  function syncScroll() { lineNums.scrollTop = editor.scrollTop; }

  function highlightErrorLine(errLine) {
    const spans = lineNums.querySelectorAll('.ln');
    spans.forEach((s) => s.classList.remove('err'));
    if (errLine && errLine >= 1 && errLine <= spans.length) spans[errLine - 1].classList.add('err');
  }

  function clearHighlights() {
    [stageFetch, stageDecode, stageExecute].forEach((s) => s.classList.remove('active'));
    [stageFetch, stageDecode, stageExecute].forEach((s) => s.classList.add('idle'));
    blockPC.classList.remove('active');
    blockIR.classList.remove('active');
    blockRegs.classList.remove('active');
    blockFlags.classList.remove('active');
    blockALU.classList.remove('active');
    blockMem.classList.remove('active');
    blockCU.classList.remove('active');
  }

  function highlightStage(stage) {
    clearHighlights();
    if (stage === 'fetch') { stageFetch.classList.add('active'); blockPC.classList.add('active'); blockIR.classList.add('active'); blockCU.classList.add('active'); }
    else if (stage === 'decode') { stageDecode.classList.add('active'); blockCU.classList.add('active'); }
    else if (stage === 'execute') { stageExecute.classList.add('active'); blockALU.classList.add('active'); blockMem.classList.add('active'); blockCU.classList.add('active'); }
  }

  function updateDisplays() {
    pcDisplay.textContent = 'PC=' + cpu.pc;
    irDisplay.textContent = cpu.ir ? 'IR=' + cpu.ir.raw : 'IR=—';
    cycleReadout.textContent = 'cycle ' + cpu.cycle;

    let regsHtml = '';
    for (let i = 0; i < 8; i++) {
      regsHtml += '<span class="reg-chip"><span class="rn">R' + i + '</span><span class="rv">' + cpu.regs[i] + '</span></span> ';
    }
    regsPanel.innerHTML = regsHtml;

    let memHtml = '';
    const startAddr = 0;
    const count = Math.min(32, cpu.mem.length);
    for (let i = startAddr; i < startAddr + count; i++) {
      const hl = cpu.memAccess === i ? ' hl' : '';
      memHtml += '<span class="mem-cell' + hl + '"><span class="ma">' + i + '</span><span class="mv">' + cpu.mem[i] + '</span></span>';
    }
    memPanel.innerHTML = memHtml;

    consolePanel.innerHTML = cpu.output.map((l) => '<div class="out-line">' + escapeHtml(l) + '</div>').join('');
    consolePanel.scrollTop = consolePanel.scrollHeight;

    flagZ.className = 'flag ' + (cpu.flags.Z ? 'on' : 'off');
    flagN.className = 'flag ' + (cpu.flags.N ? 'on' : 'off');
    flagC.className = 'flag ' + (cpu.flags.C ? 'on' : 'off');

    if (cpu.error) statusText.textContent = 'Error: ' + cpu.error;
    else if (cpu.halted) statusText.textContent = 'HLT — program finished';
    else statusText.textContent = 'Ready — click Run or Step';
  }

  function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function step() {
    if (cpu.halted || cpu.error) return;
    const stage = executeStage(cpu, prog);
    cpu.cycle++;
    track('pipeline_step', { stage: stage, pc: cpu.pc });
    highlightStage(stage);
    updateDisplays();
    if (cpu.halted) { track('simulator_completed', { via: 'halt' }); }
  }

  function run() {
    if (cpu.running) { stopRun(); return; }
    if (cpu.halted || cpu.error) return;
    cpu.running = true;
    btnRun.textContent = '⏸ Pause';
    btnRun.classList.add('active');
    const speed = parseInt(speedSlider.value, 10) || 4;
    const delay = Math.max(30, 500 / speed);
    runTimer = setInterval(() => {
      if (cpu.halted || cpu.error) { stopRun(); return; }
      step();
    }, delay);
  }

  function stopRun() {
    cpu.running = false;
    if (runTimer) { clearInterval(runTimer); runTimer = null; }
    btnRun.textContent = '▶ Run';
    btnRun.classList.remove('active');
  }

  function reset() {
    stopRun();
    const code = editor.value;
    const result = assemble(code);
    if (!result.ok) {
      cpu.error = result.error;
      cpu.halted = false;
      updateDisplays();
      highlightErrorLine(null);
      return;
    }
    Object.assign(cpu, createCPU());
    prog = result.instructions;
    clearHighlights();
    updateDisplays();
    updateLineNums();
    highlightErrorLine(null);
    track('simulator_reset');
  }

  function loadExample(key) {
    if (!EXAMPLES.hasOwnProperty(key)) return;
    editor.value = EXAMPLES[key];
    updateLineNums();
    reset();
    track('example_loaded', { example: key });
  }

  /* ---------- Event wiring ---------- */
  editor.addEventListener('input', () => { updateLineNums(); });
  editor.addEventListener('scroll', syncScroll);
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = editor.selectionStart;
      const end = editor.selectionEnd;
      editor.value = editor.value.slice(0, s) + '  ' + editor.value.slice(end);
      editor.selectionStart = editor.selectionEnd = s + 2;
    }
  });

  btnRun.addEventListener('click', () => {
    if (cpu.running) { stopRun(); track('run_paused'); }
    else { run(); track('run_started'); }
  });
  btnStep.addEventListener('click', () => { step(); track('step'); });
  btnReset.addEventListener('click', () => { reset(); track('reset'); });

  speedSlider.addEventListener('input', () => { speedVal.textContent = speedSlider.value + '×'; });

  exampleSelect.addEventListener('change', () => {
    if (exampleSelect.value) { loadExample(exampleSelect.value); exampleSelect.value = ''; }
  });

  /* ---------- Init ---------- */
  updateLineNums();
  reset();
  track('simulator_opened');
})();