/* Guest mobile number checked against its country code (2026-10-22).
 * No server needed, writes nothing: runs the shared field rules and the CSV
 * import review directly. `node tests/guest-mobile-country.test.js` */
require('dotenv').config();
const { WebsiteClient, sequelize } = require('../src/models');
const { normalisePerson, normaliseAttendance } = require('../src/services/guestFields');
const importSvc = require('../src/services/clientGuestImport.service');
const { checkMobile } = require('../src/utils/phone');

let pass = 0, fail = 0;
const ok = (l, c, x = '') => { if (c) { pass++; console.log(`  PASS  ${l}`); } else { fail++; console.log(`  FAIL  ${l}  ${x}`); } };
const refused = async (body, opts) => {
    try { await normalisePerson(1, body, opts); return null; } catch (e) { return e.message; }
};

(async () => {
    console.log('── checkMobile ──');
    ok('India 10-digit mobile', checkMobile('+91', '9876543210').ok);
    ok('India too short refused', !checkMobile('+91', '98765').ok);
    ok('India landline-shaped refused', !checkMobile('+91', '1234567890').ok);
    ok('India leading 0 dropped', checkMobile('+91', '09876543210').national === '9876543210');
    ok('UAE 9-digit mobile', checkMobile('+971', '501234567').ok);
    ok('Indian number under +971 refused', !checkMobile('+971', '9876543210').ok);
    ok('typed +code wins', checkMobile('+91', '+971501234567').dialCode === '+971');
    ok('US number', checkMobile('+1', '2015550123').ok);
    ok('UK mobile', checkMobile('+44', '7400123456').ok);

    console.log('── guest add / edit ──');
    const base = { first_name: 'Test' };
    const good = await normalisePerson(1, { ...base, dial_code: '+91', mobile: '98765 43210' }, { checkMobileCountry: true });
    ok('valid guest saved as national digits', good.mobile === '9876543210' && good.dial_code === '+91', JSON.stringify(good));
    const bad = await refused({ ...base, dial_code: '+971', mobile: '9876543210' }, { checkMobileCountry: true });
    ok('wrong length for +971 refused', bad === 'Please enter a valid mobile number for +971.', bad);
    const edit = await refused({ dial_code: '+44' }, { partial: true, existing: { mobile: '9876543210', dial_code: '+91' }, checkMobileCountry: true });
    ok('edit changing only the code re-checks the stored number', !!edit, edit);
    const looseCaller = await refused({ ...base, mobile: '98765' }, { withGroup: false });
    ok('without checkMobileCountry the loose check stays', looseCaller === null, looseCaller);
    const participant = await refused({ ...base, dial_code: '+65', mobile: '98765' }, { withGroup: false, checkMobileCountry: true });
    ok('participant: short Singapore number refused', participant === 'Please enter a valid mobile number for +65.', participant);
    const sg = await normalisePerson(1, { ...base, dial_code: '+65', mobile: '81234567' }, { withGroup: false, checkMobileCountry: true });
    ok('participant: Singapore mobile saved with +65', sg.dial_code === '+65' && sg.mobile === '81234567', JSON.stringify(sg));

    console.log('-- organizer RSVP answer on Add Participant --');
    const yes = normaliseAttendance({ response_type: 'yes', rsvp_status: 'accepted', party_size: 3, plus_one: 1, plus_one_count: 2 });
    ok('Attending -> yes/accepted, 3 guests', yes.response_type === 'yes' && yes.rsvp_status === 'accepted' && yes.party_size === 3 && !!yes.responded_at, JSON.stringify(yes));
    const no = normaliseAttendance({ response_type: 'no', rsvp_status: 'declined', party_size: 1 });
    ok('Not Attending -> no/declined', no.response_type === 'no' && no.rsvp_status === 'declined');

    console.log('── CSV import review ──');
    const client = await WebsiteClient.findOne({ order: [['id', 'ASC']] });
    const content = [
        'First Name*,Phone Number*',
        'Good,9876543211',
        'Short,98765',
        'Dubai,+971501234567',
    ].join('\n');
    const parsed = await importSvc.parseCsv(client.id, { content });
    const row = (n) => parsed.preview.find((r) => r.first_name === n);
    ok('good Indian row kept', row('Good')?.mobile === '9876543211' || parsed.skipped.some((s) => s.name === 'Good'), JSON.stringify(parsed.errors));
    ok('short number is a row error', parsed.errors.some((e) => e.name === 'Short'), JSON.stringify(parsed.errors));
    const dubai = row('Dubai');
    ok('+971 row stored with its own code', !dubai || (dubai.dial_code === '+971' && dubai.mobile === '501234567'), JSON.stringify(dubai));

    console.log(`\n${pass} passed, ${fail} failed`);
    await sequelize.close();
    process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error(e); await sequelize.close(); process.exit(1); });
