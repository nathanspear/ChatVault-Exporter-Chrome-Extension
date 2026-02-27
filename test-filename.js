/**
 * test-filename.js
 *
 * Tests for filename-builder.js.
 * Run with Node.js:  node test-filename.js
 * Or open test-filename.html in a browser.
 */

// ---------------------------------------------------------------------------
// Load the module (Node.js compatible shim)
// ---------------------------------------------------------------------------
(function loadModule() {
  if (typeof slugForExport === 'undefined') {
    // Node.js: simulate the self/window export that filename-builder.js uses
    global.self = global;
    require('./filename-builder.js');
  }
})();

// ---------------------------------------------------------------------------
// Minimal test harness
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;

function assert(description, actual, expected) {
  if (actual === expected) {
    console.log('  PASS  ' + description);
    passed++;
  } else {
    console.error('  FAIL  ' + description);
    console.error('        expected: ' + expected);
    console.error('        actual:   ' + actual);
    failed++;
  }
}

function assertContains(description, actual, substring) {
  if (actual.includes(substring)) {
    console.log('  PASS  ' + description);
    passed++;
  } else {
    console.error('  FAIL  ' + description);
    console.error('        expected to contain: ' + substring);
    console.error('        actual: ' + actual);
    failed++;
  }
}

function assertNotContains(description, actual, substring) {
  if (!actual.includes(substring)) {
    console.log('  PASS  ' + description);
    passed++;
  } else {
    console.error('  FAIL  ' + description);
    console.error('        expected NOT to contain: ' + substring);
    console.error('        actual: ' + actual);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Test 1 — User-supplied project name appears in filename at correct position
// ---------------------------------------------------------------------------
console.log('\nTest 1: User-supplied project name in filename');
(function() {
  const result = buildExportFilename({
    projectName: 'Tanget',
    chatName:    'Article Request Clarification',
    ext:         'json',
    exportDate:  '2026-02-21',
  });
  assert('full filename with user project name',
    result,
    'ChatVault-export--Tanget--Article-Request-Clarification--2026-02-21.json');
  assertContains('prefix is ChatVault-export',       result, 'ChatVault-export--');
  assertContains('user project name in position',    result, '--Tanget--');
  assertContains('chat name in third segment',       result, '--Article-Request-Clarification--');
  assertContains('date in last segment before ext',  result, '--2026-02-21.json');
  
  const result2 = buildExportFilename({
    projectName: 'Family',
    chatName:    'Taxes Overview',
    ext:         'md',
    exportDate:  '2026-02-21',
  });
  assert('another user project name example',
    result2,
    'ChatVault-export--Family--Taxes-Overview--2026-02-21.md');
})();

// ---------------------------------------------------------------------------
// Test 2 — Chat with no project uses "Unassigned"
// ---------------------------------------------------------------------------
console.log('\nTest 2: Chat with no project uses "Unassigned"');
(function() {
  const result = buildExportFilename({
    projectName: null,
    chatName:    'My Chat',
    ext:         'md',
    exportDate:  '2026-02-21',
  });
  assert('filename uses Unassigned for missing project',
    result,
    'ChatVault-export--Unassigned--My-Chat--2026-02-21.md');

  const result2 = buildExportFilename({
    projectName: '',
    chatName:    'Another Chat',
    ext:         'json',
    exportDate:  '2026-02-21',
  });
  assertContains('empty string project also gives Unassigned', result2, '--Unassigned--');
})();

// ---------------------------------------------------------------------------
// Test 3 — Illegal characters are removed or replaced
// ---------------------------------------------------------------------------
console.log('\nTest 3: Illegal characters are removed or replaced');
(function() {
  const result = buildExportFilename({
    projectName: 'My/Project\\Name:Bad*Chars?"<>|',
    chatName:    'Chat: "Important" <Data>',
    ext:         'json',
    exportDate:  '2026-02-21',
  });
  assertNotContains('no forward slash in result',       result, '/');
  assertNotContains('no backslash in result',           result, '\\');
  assertNotContains('no colon in result',               result, ':');
  assertNotContains('no asterisk in result',            result, '*');
  assertNotContains('no question mark in result',       result, '?');
  assertNotContains('no double-quote in result',        result, '"');
  assertNotContains('no less-than in result',           result, '<');
  assertNotContains('no greater-than in result',        result, '>');
  assertNotContains('no pipe in result',                result, '|');
  // Slugified project should still have some safe text
  assertContains('project has safe chars remaining',    result, '--My');
})();

// ---------------------------------------------------------------------------
// Test 4 — Collision in same folder gets deterministic shortChatId suffix
// ---------------------------------------------------------------------------
console.log('\nTest 4: Collision produces deterministic shortChatId suffix');
(function() {
  const usedNames = new Set();
  const opts = {
    projectName: 'Family',
    chatName:    'Taxes Overview',
    ext:         'json',
    exportDate:  '2026-02-21',
    chatId:      'abc-12345xyz',
    usedNames,
  };

  const first = buildExportFilename(opts);
  assert('first filename has no collision suffix',
    first,
    'ChatVault-export--Family--Taxes-Overview--2026-02-21.json');

  // Second call with same names + same Set → collision
  const second = buildExportFilename(opts);
  assert('second filename has deterministic shortChatId suffix',
    second,
    'ChatVault-export--Family--Taxes-Overview--abc12345--2026-02-21.json');

  // Third call — shortId+counter variant
  const third = buildExportFilename(opts);
  assert('third filename has shortId+2 suffix',
    third,
    'ChatVault-export--Family--Taxes-Overview--abc123452--2026-02-21.json');
  assert('third filename differs from first',  third !== first,  true);
  assert('third filename differs from second', third !== second, true);
})();

// ---------------------------------------------------------------------------
// Test 5 — Prefix is exactly "ChatVault-export" and separators are exactly "--"
// ---------------------------------------------------------------------------
console.log('\nTest 5: Prefix and separator format');
(function() {
  const result = buildExportFilename({
    projectName: 'Job Search',
    chatName:    'LinkedIn Optimization Help',
    ext:         'md',
    exportDate:  '2026-02-20',
  });
  assert('starts with exact prefix ChatVault-export--',
    result.startsWith('ChatVault-export--'), true);
  // Case is preserved (LinkedIn stays LinkedIn, not lowercased to Linkedin)
  assert('full canonical filename matches',
    result,
    'ChatVault-export--Job-Search--LinkedIn-Optimization-Help--2026-02-20.md');
  const parts = result.replace(/\.md$/, '').split('--');
  assert('exactly 4 segments (prefix, project, chat, date)',
    parts.length, 4);
  assert('segment 0 is ChatVault-export', parts[0], 'ChatVault-export');
  assert('segment 1 is project slug',     parts[1], 'Job-Search');
  assert('segment 2 is chat slug',        parts[2], 'LinkedIn-Optimization-Help');
  assert('segment 3 is date',             parts[3], '2026-02-20');
})();

// ---------------------------------------------------------------------------
// Test 6 — UI project name "Apps" → filename contains "--Apps--", never "--Unassigned--"
// ---------------------------------------------------------------------------
console.log('\nTest 6: UI project name "Apps" propagates correctly (regression for state-propagation bug)');
(function() {
  // Simulate what background.js does when authorizedProjectName = "Apps"
  // and chat title is "Apps: App Ideas & Suggestions"
  const result = buildExportFilename({
    projectName: 'Apps',
    chatName:    'Apps: App Ideas & Suggestions',
    ext:         'md',
    exportDate:  '2026-02-21',
  });
  assertContains('filename contains --Apps--', result, '--Apps--');
  assertNotContains('filename does NOT contain --Unassigned--', result, '--Unassigned--');
  assert('full filename matches expected',
    result,
    'ChatVault-export--Apps--Apps-App-Ideas-Suggestions--2026-02-21.md');
})();

// ---------------------------------------------------------------------------
// Test 7 — Blank UI project name → "Unassigned" (and only then)
// ---------------------------------------------------------------------------
console.log('\nTest 7: Blank project name → Unassigned (and only then)');
(function() {
  const blank = buildExportFilename({
    projectName: null,
    chatName:    'Some Chat',
    ext:         'json',
    exportDate:  '2026-02-21',
  });
  assertContains('null project name → Unassigned', blank, '--Unassigned--');

  const empty = buildExportFilename({
    projectName: '',
    chatName:    'Some Chat',
    ext:         'json',
    exportDate:  '2026-02-21',
  });
  assertContains('empty string project name → Unassigned', empty, '--Unassigned--');

  const provided = buildExportFilename({
    projectName: 'Apps',
    chatName:    'Some Chat',
    ext:         'json',
    exportDate:  '2026-02-21',
  });
  assertNotContains('non-blank project name never gives Unassigned', provided, '--Unassigned--');
  assertContains('non-blank project name uses provided value', provided, '--Apps--');
})();

// ---------------------------------------------------------------------------
// Test 8 — buildExportFolderName produces correct flat folder name
// ---------------------------------------------------------------------------
console.log('\nTest 8: buildExportFolderName — flat folder naming');
(function() {
  const result = buildExportFolderName({
    projectName: 'Job Search',
    exportDate:  '2026-02-21',
  });
  assert('folder name with project',
    result,
    'ChatVault-export--Job-Search--2026-02-21');
  assert('starts with correct prefix',
    result.startsWith('ChatVault-export--'), true);

  const unassigned = buildExportFolderName({
    projectName: null,
    exportDate:  '2026-02-21',
  });
  assert('blank project → Unassigned folder',
    unassigned,
    'ChatVault-export--Unassigned--2026-02-21');

  const emptyStr = buildExportFolderName({
    projectName: '',
    exportDate:  '2026-02-21',
  });
  assert('empty project → Unassigned folder',
    emptyStr,
    'ChatVault-export--Unassigned--2026-02-21');
})();

// ---------------------------------------------------------------------------
// Test 9 — Flat folder structure: index files are always present
// ---------------------------------------------------------------------------
console.log('\nTest 9: Flat folder — required index files exist');
(function() {
  // Simulate what background.js assembles
  const projectName = 'Job Search';
  const exportDate  = '2026-02-21';
  const folderName  = buildExportFolderName({ projectName, exportDate });

  const mdFile = buildExportFilename({
    projectName,
    chatName:   'LinkedIn Optimization Help',
    ext:        'md',
    exportDate,
  });
  const jsonFile = buildExportFilename({
    projectName,
    chatName:   'LinkedIn Optimization Help',
    ext:        'json',
    exportDate,
  });

  // The files that must always be present
  const requiredFiles = [
    `${folderName}/00-project-index.md`,
    `${folderName}/00-project-summary.md`,
    `${folderName}/manifest.json`,
    `${folderName}/${mdFile}`,
  ];

  requiredFiles.forEach(function(f) {
    assert('required file path is well-formed: ' + f,
      f.startsWith('ChatVault-export--Job-Search--2026-02-21/'), true);
  });

  assert('chat md file in folder',
    `${folderName}/${mdFile}`,
    'ChatVault-export--Job-Search--2026-02-21/ChatVault-export--Job-Search--LinkedIn-Optimization-Help--2026-02-21.md');

  assert('chat json file in folder',
    `${folderName}/${jsonFile}`,
    'ChatVault-export--Job-Search--2026-02-21/ChatVault-export--Job-Search--LinkedIn-Optimization-Help--2026-02-21.json');
})();

// ---------------------------------------------------------------------------
// Test 10 — includeJson off → no .json chat files
// ---------------------------------------------------------------------------
console.log('\nTest 10: includeJson toggle — off means no json chat files');
(function() {
  // Simulate the background.js loop with includeJson = false
  const includeJson = false;
  const files = [];

  const mdFilename = buildExportFilename({
    projectName: 'Family',
    chatName:    'Summer Plans',
    ext:         'md',
    exportDate:  '2026-02-21',
  });
  files.push(mdFilename);

  if (includeJson) {
    const jsonFilename = mdFilename.replace(/\.md$/, '.json');
    files.push(jsonFilename);
  }

  const hasJsonChat = files.some(function(f) { return f.endsWith('.json'); });
  assert('no .json chat files when includeJson is false', hasJsonChat, false);
  assert('md file is present when includeJson is false', files.some(function(f) { return f.endsWith('.md'); }), true);
})();

// ---------------------------------------------------------------------------
// Test 11 — includeJson on → .json chat files are created
// ---------------------------------------------------------------------------
console.log('\nTest 11: includeJson toggle — on means json chat files exist');
(function() {
  const includeJson = true;
  const files = [];

  const mdFilename = buildExportFilename({
    projectName: 'Family',
    chatName:    'Summer Plans',
    ext:         'md',
    exportDate:  '2026-02-21',
  });
  files.push(mdFilename);

  if (includeJson) {
    const jsonFilename = mdFilename.replace(/\.md$/, '.json');
    files.push(jsonFilename);
  }

  assert('md file is present when includeJson is true',   files.some(function(f) { return f.endsWith('.md');   }), true);
  assert('json file is present when includeJson is true', files.some(function(f) { return f.endsWith('.json'); }), true);
  assert('json filename matches md filename with swapped ext',
    files[1],
    'ChatVault-export--Family--Summer-Plans--2026-02-21.json');
})();

// ---------------------------------------------------------------------------
// Test 12 — createZip off → no zip file
// ---------------------------------------------------------------------------
console.log('\nTest 12: createZip toggle — off means no zip created');
(function() {
  const createZip = false;
  let zipFilename = null;

  if (createZip) {
    const folderName = buildExportFolderName({ projectName: 'Family', exportDate: '2026-02-21' });
    zipFilename = folderName + '.zip';
  }

  assert('no zip filename when createZip is false', zipFilename, null);
})();

// ---------------------------------------------------------------------------
// Test 13 — createZip on → zip filename is correct
// ---------------------------------------------------------------------------
console.log('\nTest 13: createZip toggle — on means zip filename is correct');
(function() {
  const createZip = true;
  let zipFilename = null;

  if (createZip) {
    const folderName = buildExportFolderName({ projectName: 'Family', exportDate: '2026-02-21' });
    zipFilename = folderName + '.zip';
  }

  assert('zip filename correct when createZip is true',
    zipFilename,
    'ChatVault-export--Family--2026-02-21.zip');
  assert('zip has .zip extension', zipFilename.endsWith('.zip'), true);
})();

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('\n----------------------------------------');
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exitCode = 1;
