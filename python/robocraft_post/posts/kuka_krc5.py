









from ..base import register
from .kuka_krc import KukaKrc4


@register
class KukaKrc5(KukaKrc4):
    name = "KUKA_KRC5"
