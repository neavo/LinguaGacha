"""API 路由集合。"""

from api.Server.Routes.ProofreadingRoutes import ProofreadingRoutes
from api.Server.Routes.QualityRoutes import QualityRoutes

__all__: list[str] = ["ProofreadingRoutes", "QualityRoutes"]
