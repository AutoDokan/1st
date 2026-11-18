const fs = require('fs');
let s = fs.readFileSync('server.js', 'utf8');

const startMarker = '// Unified Master Dashboard (Executive F-Commerce Command Center for Dawah Fashion)';
const endMarker = "app.get('/qr', (req, res) => {";

const startIndex = s.indexOf(startMarker);
const endIndex = s.indexOf(endMarker);

console.log('Start index:', startIndex);
console.log('End index:', endIndex);

if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
  const mountBlock = `// ==========================================
// Dedicated Super Admin Executive Command Center Router
// ==========================================
const { createSuperAdminRouter } = require('./superadmin_dashboard');
app.use('/', requireAuth, createSuperAdminRouter({
  supabase,
  sellerStatuses,
  sellerNumbers,
  sellerSockets,
  sellerQRs,
  startSellerSession,
  refreshProductsFromDB,
  refreshSettingsFromDB,
  getSellerWhatsAppInfo
}));

`;
  const updated = s.substring(0, startIndex) + mountBlock + s.substring(endIndex);
  fs.writeFileSync('server.js', updated, 'utf8');
  console.log('Successfully replaced old dashboard and mounted superadmin_dashboard.js in server.js!');
} else {
  console.error('Markers not found!');
  process.exit(1);
}
