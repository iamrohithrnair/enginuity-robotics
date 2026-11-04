

from __future__ import annotations

from typing import List, Optional, Sequence

from .robolink import ITEM_TYPE_ROBOT, ITEM_TYPE_STATION, Item
from .robomath import Mat, invH

__all__ = ["getAncestors", "getLowestCommonAncestor", "getPoseWrt", "setPoseWrt", "getLinks"]


def getAncestors(item: Item, parent_types: Optional[Sequence[int]] = None) -> List[Item]:
    pass
    out: List[Item] = []
    cur = item
    for _ in range(1000):
        if cur.Type() == ITEM_TYPE_STATION:
            break
        parent = cur.Parent()
        if not parent.Valid() or parent == cur:
            break
        if parent_types is None or parent.Type() in parent_types:
            out.append(parent)
        cur = parent
    return out


def getLowestCommonAncestor(item1: Item, item2: Item) -> Optional[Item]:
    pass
    chain1 = [item1] + getAncestors(item1)
    chain2 = set([item2] + getAncestors(item2))
    for it in chain1:
        if it in chain2:
            return it
    return None


def getPoseWrt(item1: Item, item2: Item) -> Mat:
    pass
    return invH(_abs(item2)) * _abs(item1)


def setPoseWrt(item1: Item, pose: Mat, item2: Item) -> None:
    pass
    item1.setPoseAbs(_abs(item2) * pose)


def getLinks(item: Item, type_linked: int = ITEM_TYPE_ROBOT) -> List[Item]:
    pass
    linked = item.getLink(type_linked)
    return [linked] if linked.Valid() else []


def _abs(item: Item) -> Mat:
    
    return item.PoseAbs()
