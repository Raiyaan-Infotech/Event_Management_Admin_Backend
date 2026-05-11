const { User, Vendor, VendorClient } = require('../models');

const ADMIN_ATTRS   = ['id', 'full_name', 'email'];
const VENDOR_ATTRS  = ['id', 'company_name', 'email'];
const CLIENT_ATTRS  = ['id', 'name', 'email'];

const getContacts = async (caller) => {
  const result = { admins: [], vendors: [], clients: [] };

  if (caller.type === 'admin') {
    const [vendors, clients] = await Promise.all([
      Vendor.findAll({ where: { status: 'active' }, attributes: VENDOR_ATTRS }),
      VendorClient.findAll({ where: { is_active: 1 }, attributes: CLIENT_ATTRS }),
    ]);
    result.vendors = vendors.map(v => ({ id: v.id, name: v.company_name, email: v.email, type: 'vendor' }));
    result.clients = clients.map(c => ({ id: c.id, name: c.name, email: c.email, type: 'client' }));
  }

  if (caller.type === 'vendor') {
    const [admins, clients] = await Promise.all([
      User.findAll({ where: { is_active: 1 }, attributes: ADMIN_ATTRS }),
      VendorClient.findAll({ where: { vendor_id: caller.vendorId, is_active: 1 }, attributes: CLIENT_ATTRS }),
    ]);
    result.admins  = admins.map(a => ({ id: a.id, name: a.full_name, email: a.email, type: 'admin' }));
    result.clients = clients.map(c => ({ id: c.id, name: c.name, email: c.email, type: 'client' }));
  }

  if (caller.type === 'client') {
    const vendor = await Vendor.findByPk(caller.vendorId, { attributes: VENDOR_ATTRS });
    if (vendor) {
      result.vendors = [{ id: vendor.id, name: vendor.company_name, email: vendor.email, type: 'vendor' }];
    }
  }

  return result;
};

module.exports = { getContacts };
