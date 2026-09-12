from .fallback import ProviderFallbackPolicy
from .provider_config import ProviderConfigStore
from .provider_registry import ProviderRegistry
from .third_party import ThirdPartyVideoAdapter


class ProviderRouter:
    def __init__(self, registry: ProviderRegistry, configs: ProviderConfigStore):
        self.registry = registry; self.configs = configs; self.fallback = ProviderFallbackPolicy()

    def descriptors(self) -> list[dict]: return self.registry.available()

    def resolve(self, provider_id: str):
        if provider_id == "libtv-cli": return self.registry.get(provider_id)
        config = next((item for item in self.configs.list() if item.get("providerId") == provider_id), None)
        return ThirdPartyVideoAdapter(config) if config else None
