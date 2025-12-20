class ProviderRegistry {
  constructor(options = {}) {
    this.providers = new Map();
    this.defaultProvider = (options.defaultProvider || 'twilio').toLowerCase();
    this.supported = new Set(options.supportedProviders || []);
    this.active = null;
  }

  normalize(name) {
    const candidate = (name || this.defaultProvider || '').toLowerCase();
    if (this.supported.size === 0 || this.supported.has(candidate)) {
      return candidate;
    }
    return this.defaultProvider;
  }

  register(name, handlers = {}) {
    const key = (name || '').toLowerCase();
    if (!key) {
      throw new Error('ProviderRegistry.register requires a provider name');
    }
    this.providers.set(key, handlers);
    this.supported.add(key);
  }

  async activate(name, context = {}) {
    const normalized = this.normalize(name);
    const handlers = this.providers.get(normalized);
    if (!handlers) {
      throw new Error(`Provider "${normalized}" is not registered`);
    }

    if (handlers.validate) {
      await handlers.validate(context);
    }

    const activationResult = handlers.ensure ? await handlers.ensure(context) : null;
    this.active = {
      name: normalized,
      details: activationResult || {},
    };
    return this.active;
  }

  getActiveName() {
    return this.active?.name || this.defaultProvider;
  }
}

module.exports = ProviderRegistry;
