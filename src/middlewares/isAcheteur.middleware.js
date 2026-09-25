module.exports = (req, res, next) => {
  if (req.user?.role !== 'Acheteur') {
    return res.status(403).json({ message: 'Accès réservé aux acheteurs' });
  }
  next();
};
