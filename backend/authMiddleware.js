const requireAuth = (req, res, next) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized. Please log in.' });
  }
  next();
};

const requireAdmin = (req, res, next) => {
  if (!req.session.userId || req.session.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden. Admin access required.' });
  }
  next();
};

module.exports = {
  requireAuth,
  requireAdmin
};
