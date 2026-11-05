# Registers KUKA KRC5 output using the shared KRC4 program generator.









from ..base import register
from .kuka_krc import KukaKrc4


@register
class KukaKrc5(KukaKrc4):
    name = "KUKA_KRC5"
