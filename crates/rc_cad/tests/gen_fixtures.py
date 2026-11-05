# Builds deterministic STEP fixtures for CAD import checks.





import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "data")


class Step:
    def __init__(self):
        self.lines = []
        self.n = 0

    def add(self, text):
        self.n += 1
        self.lines.append(f"#{self.n}={text};")
        return f"#{self.n}"

    def num(self, v):
        s = repr(float(v))
        return s.upper()

    def pt(self, p):
        return self.add(f"CARTESIAN_POINT('',({','.join(self.num(v) for v in p)}))")

    def dirn(self, d):
        return self.add(f"DIRECTION('',({','.join(self.num(v) for v in d)}))")

    def ax2(self, o, z=(0, 0, 1), x=(1, 0, 0)):
        return self.add(f"AXIS2_PLACEMENT_3D('',{self.pt(o)},{self.dirn(z)},{self.dirn(x)})")

    def text(self, name):
        head = (
            "ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('RoboCraft test part'),'2;1');\n"
            f"FILE_NAME('{name}','',(''),(''),'','RoboCraft gen_fixtures.py','');\n"
            "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));\nENDSEC;\nDATA;\n"
        )
        return head + "\n".join(self.lines) + "\nENDSEC;\nEND-ISO-10303-21;\n"


def context(s, unit="mm", angle="rad"):
    mm = s.add("( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) )")
    length = mm
    if unit == "inch":
        m = s.add(f"LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(25.4),{mm})")
        dim = s.add("DIMENSIONAL_EXPONENTS(1.,0.,0.,0.,0.,0.,0.)")
        length = s.add(f"( CONVERSION_BASED_UNIT('INCH',{m}) LENGTH_UNIT() NAMED_UNIT({dim}) )")
    rad = s.add("( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) )")
    ang = rad
    if angle == "deg":
        m = s.add(f"PLANE_ANGLE_MEASURE_WITH_UNIT(PLANE_ANGLE_MEASURE(0.0174532925199433),{rad})")
        dim = s.add("DIMENSIONAL_EXPONENTS(0.,0.,0.,0.,0.,0.,0.)")
        ang = s.add(f"( CONVERSION_BASED_UNIT('DEGREE',{m}) NAMED_UNIT({dim}) PLANE_ANGLE_UNIT() )")
    sr = s.add("( NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT() )")
    unc = s.add(f"UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-07),{length},'distance_accuracy_value','confusion accuracy')")
    return s.add(
        f"( GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT(({unc})) "
        f"GLOBAL_UNIT_ASSIGNED_CONTEXT(({length},{ang},{sr})) REPRESENTATION_CONTEXT('Context #1','3D Context with UNIT and UNCERTAINTY') )"
    )


def colour(s, item, rgb, ctx):
    col = s.add(f"COLOUR_RGB('',{s.num(rgb[0])},{s.num(rgb[1])},{s.num(rgb[2])})")
    fasc = s.add(f"FILL_AREA_STYLE_COLOUR('',{col})")
    fas = s.add(f"FILL_AREA_STYLE('',({fasc}))")
    ssfa = s.add(f"SURFACE_STYLE_FILL_AREA({fas})")
    sss = s.add(f"SURFACE_SIDE_STYLE('',({ssfa}))")
    ssu = s.add(f"SURFACE_STYLE_USAGE(.BOTH.,{sss})")
    psa = s.add(f"PRESENTATION_STYLE_ASSIGNMENT(({ssu}))")
    si = s.add(f"STYLED_ITEM('color',({psa}),{item})")
    s.add(f"MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION('',({si}),{ctx})")


def line_edge(s, va, vb, a, b):
    d = [b[i] - a[i] for i in range(3)]
    ln = math.sqrt(sum(v * v for v in d))
    vec = s.add(f"VECTOR('',{s.dirn([v / ln for v in d])},{s.num(ln)})")
    line = s.add(f"LINE('',{s.pt(a)},{vec})")
    return s.add(f"EDGE_CURVE('',{va},{vb},{line},.T.)")


def oe(s, e, fwd):
    return s.add(f"ORIENTED_EDGE('',*,*,{e},{'.T.' if fwd else '.F.'})")


def face(s, edges, surf, same=True, outer=True):
    loop = s.add(f"EDGE_LOOP('',({','.join(edges)}))")
    bound = s.add(f"{'FACE_OUTER_BOUND' if outer else 'FACE_BOUND'}('',{loop},.T.)")
    return s.add(f"ADVANCED_FACE('',({bound}),{surf},{'.T.' if same else '.F.'})")


def box_brep(s, dx, dy, dz, bspline_top=False):
    P = [(x, y, z) for z in (0, dz) for y in (0, dy) for x in (0, dx)]
    V = [s.add(f"VERTEX_POINT('',{s.pt(p)})") for p in P]
    E = {}

    def edge(i, j):
        if (i, j) in E:
            return E[(i, j)], True
        if (j, i) in E:
            return E[(j, i)], False
        E[(i, j)] = line_edge(s, V[i], V[j], P[i], P[j])
        return E[(i, j)], True

    def quad(ids, surf, same=True):
        oes = []
        for k in range(4):
            e, fwd = edge(ids[k], ids[(k + 1) % 4])
            oes.append(oe(s, e, fwd))
        return face(s, oes, surf, same)

    faces = []
    
    faces.append(quad([0, 2, 3, 1], s.add(f"PLANE('',{s.ax2((0, 0, 0), (0, 0, 1))})"), same=False))
    if bspline_top:
        pts = f"(({s.pt((0, 0, dz))},{s.pt((0, dy, dz))}),({s.pt((dx, 0, dz))},{s.pt((dx, dy, dz))}))"
        top = s.add(f"B_SPLINE_SURFACE_WITH_KNOTS('',1,1,{pts},.PLANE_SURF.,.F.,.F.,.F.,(2,2),(2,2),(0.,1.),(0.,1.),.UNSPECIFIED.)")
    else:
        top = s.add(f"PLANE('',{s.ax2((0, 0, dz), (0, 0, 1))})")
    faces.append(quad([4, 5, 7, 6], top))
    faces.append(quad([0, 1, 5, 4], s.add(f"PLANE('',{s.ax2((0, 0, 0), (0, -1, 0))})")))
    faces.append(quad([2, 6, 7, 3], s.add(f"PLANE('',{s.ax2((0, dy, 0), (0, 1, 0))})")))
    faces.append(quad([0, 4, 6, 2], s.add(f"PLANE('',{s.ax2((0, 0, 0), (-1, 0, 0))})")))
    faces.append(quad([1, 3, 7, 5], s.add(f"PLANE('',{s.ax2((dx, 0, 0), (1, 0, 0))})")))
    shell = s.add(f"CLOSED_SHELL('',({','.join(faces)}))")
    return s.add(f"MANIFOLD_SOLID_BREP('box',{shell})")


def product(s, name):
    pass
    app = s.add("APPLICATION_CONTEXT('automotive design')")
    s.add(f"APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,{app})")
    mc = s.add(f"PRODUCT_CONTEXT('',{app},'mechanical')")
    p = s.add(f"PRODUCT('{name}','{name}','',({mc}))")
    pdf = s.add(f"PRODUCT_DEFINITION_FORMATION('','',{p})")
    pdc = s.add(f"PRODUCT_DEFINITION_CONTEXT('part definition',{app},'design')")
    pd = s.add(f"PRODUCT_DEFINITION('design','',{pdf},{pdc})")
    return pd, s.add(f"PRODUCT_DEFINITION_SHAPE('','',{pd})")


def single(name, brep_fn, unit="mm", angle="rad", rgb=None):
    s = Step()
    ctx = context(s, unit, angle)
    _, pds = product(s, name)
    brep = brep_fn(s)
    origin = s.ax2((0, 0, 0))
    rep = s.add(f"ADVANCED_BREP_SHAPE_REPRESENTATION('{name}',({brep},{origin}),{ctx})")
    s.add(f"SHAPE_DEFINITION_REPRESENTATION({pds},{rep})")
    if rgb:
        colour(s, brep, rgb, ctx)
    return s.text(name)


def circle(s, o, r):
    return s.add(f"CIRCLE('',{s.ax2(o)},{s.num(r)})")


def cylinder_brep(s, r=10.0, h=20.0):
    v1 = s.add(f"VERTEX_POINT('',{s.pt((r, 0, 0))})")
    v2 = s.add(f"VERTEX_POINT('',{s.pt((r, 0, h))})")
    c1 = s.add(f"EDGE_CURVE('',{v1},{v1},{circle(s, (0, 0, 0), r)},.T.)")
    c2 = s.add(f"EDGE_CURVE('',{v2},{v2},{circle(s, (0, 0, h), r)},.T.)")
    seam = line_edge(s, v1, v2, (r, 0, 0), (r, 0, h))
    side = face(s, [oe(s, c1, True), oe(s, seam, True), oe(s, c2, False), oe(s, seam, False)], s.add(f"CYLINDRICAL_SURFACE('',{s.ax2((0, 0, 0))},{s.num(r)})"))
    top = face(s, [oe(s, c2, True)], s.add(f"PLANE('',{s.ax2((0, 0, h))})"))
    bot = face(s, [oe(s, c1, False)], s.add(f"PLANE('',{s.ax2((0, 0, 0), (0, 0, -1))})"))
    shell = s.add(f"CLOSED_SHELL('',({side},{top},{bot}))")
    return s.add(f"MANIFOLD_SOLID_BREP('cylinder',{shell})")


def hemisphere_brep(s, r=10.0):
    v1 = s.add(f"VERTEX_POINT('',{s.pt((r, 0, 0))})")
    eq = s.add(f"EDGE_CURVE('',{v1},{v1},{circle(s, (0, 0, 0), r)},.T.)")
    dome = face(s, [oe(s, eq, True)], s.add(f"SPHERICAL_SURFACE('',{s.ax2((0, 0, 0))},{s.num(r)})"))
    flat = face(s, [oe(s, eq, False)], s.add(f"PLANE('',{s.ax2((0, 0, 0), (0, 0, -1))})"))
    shell = s.add(f"CLOSED_SHELL('',({dome},{flat}))")
    return s.add(f"MANIFOLD_SOLID_BREP('hemisphere',{shell})")


def frustum_brep(s, r0=5.0, h=10.0, deg=26.56505117707799):
    r1 = r0 + h * math.tan(math.radians(deg))
    v1 = s.add(f"VERTEX_POINT('',{s.pt((r0, 0, 0))})")
    v2 = s.add(f"VERTEX_POINT('',{s.pt((r1, 0, h))})")
    c1 = s.add(f"EDGE_CURVE('',{v1},{v1},{circle(s, (0, 0, 0), r0)},.T.)")
    c2 = s.add(f"EDGE_CURVE('',{v2},{v2},{circle(s, (0, 0, h), r1)},.T.)")
    seam = line_edge(s, v1, v2, (r0, 0, 0), (r1, 0, h))
    side = face(s, [oe(s, c1, True), oe(s, seam, True), oe(s, c2, False), oe(s, seam, False)], s.add(f"CONICAL_SURFACE('',{s.ax2((0, 0, 0))},{s.num(r0)},{s.num(deg)})"))
    top = face(s, [oe(s, c2, True)], s.add(f"PLANE('',{s.ax2((0, 0, h))})"))
    bot = face(s, [oe(s, c1, False)], s.add(f"PLANE('',{s.ax2((0, 0, 0), (0, 0, -1))})"))
    shell = s.add(f"CLOSED_SHELL('',({side},{top},{bot}))")
    return s.add(f"MANIFOLD_SOLID_BREP('frustum',{shell})")


def assembly(swapped=False):
    s = Step()
    ctx = context(s)
    app = s.add("APPLICATION_CONTEXT('automotive design')")
    pdc = s.add(f"PRODUCT_DEFINITION_CONTEXT('part definition',{app},'design')")
    mc = s.add(f"PRODUCT_CONTEXT('',{app},'mechanical')")

    def product(name):
        p = s.add(f"PRODUCT('{name}','{name}','',({mc}))")
        pdf = s.add(f"PRODUCT_DEFINITION_FORMATION('','',{p})")
        pd = s.add(f"PRODUCT_DEFINITION('design','',{pdf},{pdc})")
        pds = s.add(f"PRODUCT_DEFINITION_SHAPE('','',{pd})")
        return pd, pds

    pd_asm, pds_asm = product("asm")
    pd_part, pds_part = product("block")
    brep = box_brep(s, 10, 20, 30)
    ax_part = s.ax2((0, 0, 0))
    rep_part = s.add(f"ADVANCED_BREP_SHAPE_REPRESENTATION('block',({brep},{ax_part}),{ctx})")
    s.add(f"SHAPE_DEFINITION_REPRESENTATION({pds_part},{rep_part})")
    ax_asm = s.ax2((0, 0, 0))
    ax_i1 = s.ax2((0, 0, 0))
    ax_i2 = s.ax2((100, 0, 0), (0, 0, 1), (0, 1, 0))
    rep_asm = s.add(f"SHAPE_REPRESENTATION('asm',({ax_asm},{ax_i1},{ax_i2}),{ctx})")
    s.add(f"SHAPE_DEFINITION_REPRESENTATION({pds_asm},{rep_asm})")
    for k, ax in ((1, ax_i1), (2, ax_i2)):
        nauo = s.add(f"NEXT_ASSEMBLY_USAGE_OCCURRENCE('{k}','block:{k}','',{pd_asm},{pd_part},$)")
        pds = s.add(f"PRODUCT_DEFINITION_SHAPE('','',{nauo})")
        if swapped:
            idt = s.add(f"ITEM_DEFINED_TRANSFORMATION('','',{ax},{ax_part})")
            rr = s.add(f"( REPRESENTATION_RELATIONSHIP('','',{rep_asm},{rep_part}) REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION({idt}) SHAPE_REPRESENTATION_RELATIONSHIP() )")
        else:
            idt = s.add(f"ITEM_DEFINED_TRANSFORMATION('','',{ax_part},{ax})")
            rr = s.add(f"( REPRESENTATION_RELATIONSHIP('','',{rep_part},{rep_asm}) REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION({idt}) SHAPE_REPRESENTATION_RELATIONSHIP() )")
        s.add(f"CONTEXT_DEPENDENT_SHAPE_REPRESENTATION({rr},{pds})")
    colour(s, brep, (0.2, 0.4, 0.8), ctx)
    return s.text("assembly")




def iges_file(entities, name, unit_flag=2):
    pass
    def fmt(v):
        if isinstance(v, str):
            return f"{len(v)}H{v}"
        if isinstance(v, int):
            return str(v)
        return repr(float(v)).upper().replace("E", "D")

    start = ["RoboCraft test part"]
    glob = [",", ";", "RoboCraft", name, "RoboCraft", "gen_fixtures", 32, 38, 6, 308, 15, name, 1.0, unit_flag, "MM" if unit_flag == 2 else "IN", 1, 0.01, "20261020.000000", 0.001, 1000.0, "test", "RoboCraft", 11, 0, "20261020.000000"]
    gtext = "1H,,1H;," + ",".join(fmt(v) for v in glob[2:]) + ";"
    lines = []
    for i, t in enumerate(start):
        lines.append(f"{t:<72}S{i + 1:7d}")
    for i in range(0, len(gtext), 72):
        lines.append(f"{gtext[i:i + 72]:<72}G{i // 72 + 1:7d}")
    d_lines = []
    p_lines = []
    pcount = 1
    for k, (etype, params, form, color, xde) in enumerate(entities):
        de = 2 * k + 1
        text = ",".join([str(etype)] + [fmt(v) for v in params]) + ";"
        chunks = [text[i:i + 64] for i in range(0, len(text), 64)]
        start_line = pcount
        for c in chunks:
            p_lines.append(f"{c:<64} {de:7d}P{pcount:7d}")
            pcount += 1
        status = "00000000"
        d_lines.append(f"{etype:8d}{start_line:8d}{0:8d}{1:8d}{0:8d}{0:8d}{xde:8d}{0:8d}{status:>8}D{de:7d}")
        d_lines.append(f"{etype:8d}{0:8d}{color:8d}{len(chunks):8d}{form:8d}{'':8}{'':8}{'':8}{0:8d}D{de + 1:7d}")
    lines += d_lines + p_lines
    lines.append(f"S{len(start):7d}G{(len(gtext) + 71) // 72:7d}D{len(d_lines):7d}P{len(p_lines):7d}{'':40}T{1:7d}")
    return "\n".join(lines) + "\n"


def iges_plate():
    pass
    ents = []
    
    ents.append((314, [20.0, 60.0, 100.0, "BLUE"], 0, 0, 0))
    ents.append((128, [1, 1, 1, 1, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1.0, 1.0, 1.0, 1.0,
                       0, 0, 0, 40, 0, 0, 0, 20, 0, 40, 20, 0, 0, 1, 0, 1], 0, 0, 0))
    
    w = math.sqrt(0.5)
    
    cx, cy, r = 20.0, 10.0, 5.0
    ctrl = [(1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1), (1, 0)]
    wts = [1, w, 1, w, 1, w, 1, w, 1]
    knots = [0, 0, 0, 0.25, 0.25, 0.5, 0.5, 0.75, 0.75, 1, 1, 1]

    def curve126(pts):
        params = [8, 2, 1, 1, 0, 0] + knots + wts
        for p in pts:
            params += [p[0], p[1], 0.0]
        params += [0.0, 1.0, 0.0, 0.0, 1.0]
        return params

    uv = [((cx + r * a) / 40.0, (cy + r * b) / 20.0) for a, b in ctrl]
    xy = [(cx + r * a, cy + r * b) for a, b in ctrl]
    ents.append((126, curve126(uv), 0, 0, 0))
    ents.append((126, curve126(xy), 0, 0, 0))
    ents.append((142, [1, 3, 5, 7, 1], 0, 0, 0))
    ents.append((144, [3, 0, 1, 0, 9], 0, -1, 0))
    return iges_file(ents, "plate.igs")


def main():
    os.makedirs(OUT, exist_ok=True)
    files = {
        "box.stp": single("box", lambda s: box_brep(s, 10, 20, 30), rgb=(1, 0, 0)),
        "box-inch.stp": single("box-inch", lambda s: box_brep(s, 1, 2, 3), unit="inch"),
        "box-bspline-top.stp": single("box-bspline-top", lambda s: box_brep(s, 10, 20, 30, bspline_top=True)),
        "cylinder.stp": single("cylinder", cylinder_brep, rgb=(0.5, 0.5, 0.5)),
        "cylinder-r100.stp": single("cylinder-r100", lambda s: cylinder_brep(s, 100.0, 50.0)),
        "hemisphere.stp": single("hemisphere", hemisphere_brep),
        "frustum-deg.stp": single("frustum-deg", frustum_brep, angle="deg"),
        "assembly.stp": assembly(),
        "assembly-swapped.stp": assembly(swapped=True),
        "plate.igs": iges_plate(),
    }
    for name, text in files.items():
        with open(os.path.join(OUT, name), "w") as f:
            f.write(text)
        print(name, len(text))


if __name__ == "__main__":
    main()
