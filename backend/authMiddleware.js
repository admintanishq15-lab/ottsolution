const { User } = require('./models');

const requireAuth = async (req, res, next) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized. Please log in.' });
  }
  try {
    const user = await User.findById(req.session.userId);
    if (!user || user.is_banned) {
      req.session.destroy(() => {});
      return res.status(403).json({ error: 'Forbidden. Your account is banned.' });
    }
    next();
  } catch (err) {
    res.status(500).json({ error: 'Server authentication error.' });
  }
};

const requireAdmin = async (req, res, next) => {
  if (!req.session || !req.session.userId || req.session.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden. Admin access required.' });
  }
  try {
    const user = await User.findById(req.session.userId);
    if (!user || user.is_banned) {
      req.session.destroy(() => {});
      return res.status(403).json({ error: 'Forbidden. Your account is banned.' });
    }
    next();
  } catch (err) {
    res.status(500).json({ error: 'Server authentication error.' });
  }
};

module.exports = {
  requireAuth,
  requireAdmin
};
