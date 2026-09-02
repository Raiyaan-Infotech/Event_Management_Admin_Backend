const fs = require('fs');
const path = require('path');

const targetFile = 'd:/Jamal/event_client_single/src/app/dashboard/(dashboard)/settings/page.tsx';

if (!fs.existsSync(targetFile)) {
    console.error('Target file not found:', targetFile);
    process.exit(1);
}

let code = fs.readFileSync(targetFile, 'utf8');

// 1. Remove Plug from lucide-react import
code = code.replace(/SlidersHorizontal,\s*Plug,/, 'SlidersHorizontal,');

// 2. Remove 'integrations' from TAB_VALUES
code = code.replace(
    "const TAB_VALUES = ['profile', 'account', 'notifications', 'security', 'preferences', 'integrations'];",
    "const TAB_VALUES = ['profile', 'account', 'notifications', 'security', 'preferences'];"
);

// 3. Remove TabsTrigger for integrations
code = code.replace(/\r?\n\s*<TabsTrigger value="integrations">Integrations<\/TabsTrigger>/, '');

// 4. Remove TabsContent for integrations
code = code.replace(
    /\r?\n\s*<TabsContent value="integrations">[\s\S]*?<\/TabsContent>/,
    ''
);

// 5. Remove ShortcutRow for integrations
code = code.replace(
    /\r?\n\s*<ShortcutRow icon={<Plug className="size-4" \/>} title="Integrations"[\s\S]*?\/>/,
    ''
);

fs.writeFileSync(targetFile, code, 'utf8');
console.log('Successfully updated', targetFile);
