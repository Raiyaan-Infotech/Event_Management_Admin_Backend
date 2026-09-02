const { execSync } = require('child_process');

try {
    const out = execSync('npx eslint "src/app/dashboard/(dashboard)/settings/page.tsx"', {
        cwd: 'd:/Jamal/event_client_single',
        encoding: 'utf8'
    });
    console.log('ESLint Output:', out || 'Clean (no issues)');
} catch (err) {
    console.error('ESLint Error:', err.stdout || err.message);
}
