from .providers import LibTvCliAdapter
from .provider_config import ProviderConfigStore
from .config import Settings


class ProviderRegistry:
    def __init__(self, settings: Settings, configs: ProviderConfigStore | None = None):
        self.settings = settings; self.configs = configs or ProviderConfigStore()
        self._providers = {"libtv-cli": LibTvCliAdapter(settings)}

    def available(self) -> list[dict]:
        result = [{"providerId": "libtv-cli", "displayName": "LibTV CLI", "priority": 1, "enabled": True, "models": [{"modelKey": settings_model, "displayName": settings_model} for settings_model in ([self.settings.model_key] if self.settings.model_key else [])]}]
        result.extend(self.configs.public())
        return result

    def get(self, provider_id: str): return self._providers.get(provider_id)
