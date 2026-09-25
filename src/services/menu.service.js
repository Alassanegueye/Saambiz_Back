const { Menu } = require('../models');

class MenuService {
  static async listerMenus() {
    return Menu.findAll({
      where: { isActive: true },
      order: [['ordre', 'ASC'], ['name', 'ASC']],
    });
  }

  static async listerTousMenus() {
    return Menu.findAll({ order: [['ordre', 'ASC']] });
  }

  static async creerMenu({ name, code, path, icon, ordre }) {
    const existing = await Menu.findOne({ where: { code: code.toUpperCase() } });
    if (existing) {
      throw Object.assign(new Error(`Menu avec le code "${code}" existe déjà.`), { status: 409 });
    }
    return Menu.create({ name, code: code.toUpperCase(), path, icon, ordre: ordre ?? 0 });
  }

  static async modifierMenu(id, updates) {
    const menu = await Menu.findByPk(id);
    if (!menu) throw Object.assign(new Error('Menu introuvable.'), { status: 404 });
    const allowed = ['name', 'path', 'icon', 'isActive', 'ordre'];
    const safe = {};
    for (const f of allowed) {
      if (updates[f] !== undefined) safe[f] = updates[f];
    }
    return menu.update(safe);
  }

  static async supprimerMenu(id) {
    const menu = await Menu.findByPk(id);
    if (!menu) throw Object.assign(new Error('Menu introuvable.'), { status: 404 });
    await menu.destroy();
    return { message: 'Menu supprimé.' };
  }
}

module.exports = MenuService;
