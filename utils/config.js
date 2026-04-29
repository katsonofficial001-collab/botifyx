const DEFAULT_OWNER = '2349075928878';

module.exports = {
  name: 'Botify X',
  version: 'v1.0.0',
  prefix: process.env.PREFIX || '*',
  ownerNumber: process.env.OWNER_NUMBER || DEFAULT_OWNER,
  ownerJid() {
    const num = (process.env.OWNER_NUMBER || DEFAULT_OWNER).replace(/[^0-9]/g, '');
    return num ? `${num}@s.whatsapp.net` : null;
  },
};
