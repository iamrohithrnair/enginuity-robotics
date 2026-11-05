// Parses STEP Part 21 records and entity references.


use std::collections::HashMap;

#[derive(Clone, Debug, PartialEq)]
pub enum Val {
    Num(f64),
    Str(String),
    Enum(String),
    Ref(u32),
    List(Vec<Val>),
    Typed(String, Vec<Val>),
    Null,
    Star,
}

impl Val {
    pub fn num(&self) -> Option<f64> {
        match self {
            Val::Num(v) => Some(*v),
            Val::Typed(_, a) => a.first().and_then(|v| v.num()),
            _ => None,
        }
    }
    pub fn rf(&self) -> Option<u32> {
        match self {
            Val::Ref(r) => Some(*r),
            _ => None,
        }
    }
    pub fn list(&self) -> Option<&[Val]> {
        match self {
            Val::List(l) => Some(l),
            _ => None,
        }
    }
    pub fn boolean(&self) -> Option<bool> {
        match self {
            Val::Enum(e) if e == "T" => Some(true),
            Val::Enum(e) if e == "F" => Some(false),
            _ => None,
        }
    }
    pub fn enm(&self) -> Option<&str> {
        match self {
            Val::Enum(e) => Some(e),
            _ => None,
        }
    }
    pub fn refs(&self) -> Vec<u32> {
        self.list().map(|l| l.iter().filter_map(|v| v.rf()).collect()).unwrap_or_default()
    }
    pub fn nums(&self) -> Option<Vec<f64>> {
        self.list()?.iter().map(|v| v.num()).collect()
    }
}


#[derive(Debug)]
pub struct Rec {
    pub parts: Vec<(String, Vec<Val>)>,
}

pub struct File {
    pub recs: HashMap<u32, Rec>,
}

impl File {
    pub fn get(&self, id: u32) -> Option<&Rec> {
        self.recs.get(&id)
    }
    
    pub fn kind(&self, id: u32) -> &str {
        self.recs.get(&id).and_then(|r| r.parts.first()).map(|p| p.0.as_str()).unwrap_or("")
    }
    
    pub fn part(&self, id: u32, name: &str) -> Option<&[Val]> {
        self.recs.get(&id)?.parts.iter().find(|p| p.0 == name).map(|p| p.1.as_slice())
    }
    pub fn has(&self, id: u32, name: &str) -> bool {
        self.part(id, name).is_some()
    }
    pub fn simple(&self, id: u32) -> Option<(&str, &[Val])> {
        let r = self.recs.get(&id)?;
        if r.parts.len() == 1 {
            Some((r.parts[0].0.as_str(), r.parts[0].1.as_slice()))
        } else {
            None
        }
    }
}

struct Lex<'a> {
    b: &'a [u8],
    i: usize,
}

impl<'a> Lex<'a> {
    fn ws(&mut self) {
        loop {
            while self.i < self.b.len() && self.b[self.i].is_ascii_whitespace() {
                self.i += 1;
            }
            if self.i + 1 < self.b.len() && self.b[self.i] == b'/' && self.b[self.i + 1] == b'*' {
                self.i += 2;
                while self.i + 1 < self.b.len() && !(self.b[self.i] == b'*' && self.b[self.i + 1] == b'/') {
                    self.i += 1;
                }
                self.i = (self.i + 2).min(self.b.len());
            } else {
                break;
            }
        }
    }
    fn peek(&mut self) -> Option<u8> {
        self.ws();
        self.b.get(self.i).copied()
    }
    fn eat(&mut self, c: u8) -> bool {
        if self.peek() == Some(c) {
            self.i += 1;
            true
        } else {
            false
        }
    }
    fn ident(&mut self) -> String {
        self.ws();
        let s = self.i;
        while self.i < self.b.len() && (self.b[self.i].is_ascii_alphanumeric() || self.b[self.i] == b'_' || self.b[self.i] == b'-') {
            self.i += 1;
        }
        String::from_utf8_lossy(&self.b[s..self.i]).to_ascii_uppercase()
    }
    fn uint(&mut self) -> Option<u32> {
        self.ws();
        let s = self.i;
        while self.i < self.b.len() && self.b[self.i].is_ascii_digit() {
            self.i += 1;
        }
        std::str::from_utf8(&self.b[s..self.i]).ok()?.parse().ok()
    }
    fn value(&mut self, depth: u32) -> Result<Val, String> {
        if depth > 64 {
            return Err("nesting too deep".into());
        }
        match self.peek() {
            Some(b'$') => {
                self.i += 1;
                Ok(Val::Null)
            }
            Some(b'*') => {
                self.i += 1;
                Ok(Val::Star)
            }
            Some(b'#') => {
                self.i += 1;
                Ok(Val::Ref(self.uint().ok_or("bad reference")?))
            }
            Some(b'\'') => {
                self.i += 1;
                let mut s = Vec::new();
                while self.i < self.b.len() {
                    let c = self.b[self.i];
                    self.i += 1;
                    if c == b'\'' {
                        if self.b.get(self.i) == Some(&b'\'') {
                            s.push(b'\'');
                            self.i += 1;
                            continue;
                        }
                        break;
                    }
                    s.push(c);
                }
                Ok(Val::Str(String::from_utf8_lossy(&s).into_owned()))
            }
            Some(b'"') => {
                self.i += 1;
                while self.i < self.b.len() && self.b[self.i] != b'"' {
                    self.i += 1;
                }
                self.i += 1;
                Ok(Val::Null)
            }
            Some(b'.') => {
                self.i += 1;
                let s = self.i;
                while self.i < self.b.len() && self.b[self.i] != b'.' {
                    self.i += 1;
                }
                let e = String::from_utf8_lossy(&self.b[s..self.i]).trim().to_ascii_uppercase();
                self.i += 1;
                Ok(Val::Enum(e))
            }
            Some(b'(') => {
                self.i += 1;
                let mut out = Vec::new();
                if self.eat(b')') {
                    return Ok(Val::List(out));
                }
                loop {
                    out.push(self.value(depth + 1)?);
                    if self.eat(b',') {
                        continue;
                    }
                    if self.eat(b')') {
                        break;
                    }
                    return Err(format!("unexpected character at byte {}", self.i));
                }
                Ok(Val::List(out))
            }
            Some(c) if c == b'-' || c == b'+' || c.is_ascii_digit() => {
                let s = self.i;
                self.i += 1;
                while self.i < self.b.len() {
                    let c = self.b[self.i];
                    if c.is_ascii_digit() || c == b'.' || c == b'E' || c == b'e' || ((c == b'-' || c == b'+') && matches!(self.b[self.i - 1], b'E' | b'e')) {
                        self.i += 1;
                    } else {
                        break;
                    }
                }
                let t = std::str::from_utf8(&self.b[s..self.i]).map_err(|_| "bad number")?;
                let t = if t.ends_with('.') { &t[..t.len() - 1] } else { t };
                Ok(Val::Num(t.parse::<f64>().map_err(|_| format!("bad number {t}"))?))
            }
            Some(c) if c.is_ascii_alphabetic() => {
                let name = self.ident();
                if self.peek() == Some(b'(') {
                    match self.value(depth + 1)? {
                        Val::List(a) => Ok(Val::Typed(name, a)),
                        v => Ok(Val::Typed(name, vec![v])),
                    }
                } else {
                    Ok(Val::Enum(name))
                }
            }
            other => Err(format!("unexpected {:?} at byte {}", other.map(|c| c as char), self.i)),
        }
    }
    fn args(&mut self) -> Result<Vec<Val>, String> {
        match self.value(0)? {
            Val::List(a) => Ok(a),
            _ => Err("expected arguments".into()),
        }
    }
    
    fn skip_instance(&mut self) {
        let mut in_str = false;
        while self.i < self.b.len() {
            let c = self.b[self.i];
            self.i += 1;
            if c == b'\'' {
                in_str = !in_str;
            } else if c == b';' && !in_str {
                break;
            }
        }
    }
}

fn find(b: &[u8], pat: &[u8], from: usize) -> Option<usize> {
    if pat.is_empty() || b.len() < pat.len() {
        return None;
    }
    (from..=b.len() - pat.len()).find(|&i| &b[i..i + pat.len()] == pat)
}


pub fn parse(b: &[u8]) -> Result<(File, usize), String> {
    let head = &b[..b.len().min(64)];
    if find(head, b"ISO-10303-21", 0).is_none() {
        return Err("Not a STEP file (missing ISO-10303-21 header)".into());
    }
    let mut recs = HashMap::new();
    let mut bad = 0usize;
    let mut pos = 0;
    while let Some(d) = find(b, b"DATA", pos) {
        let mut lx = Lex { b, i: d + 4 };
         
        if lx.peek() == Some(b'(') {
            let _ = lx.value(0);
        }
        if !lx.eat(b';') {
            pos = d + 4;
            continue;
        }
        loop {
            match lx.peek() {
                Some(b'#') => {
                    lx.i += 1;
                    let start = lx.i;
                    let Some(id) = lx.uint() else {
                        lx.skip_instance();
                        bad += 1;
                        continue;
                    };
                    if !lx.eat(b'=') {
                        lx.i = start;
                        lx.skip_instance();
                        bad += 1;
                        continue;
                    }
                    let res = (|| -> Result<Rec, String> {
                        let mut parts = Vec::new();
                        if lx.eat(b'(') {
                            while lx.peek() != Some(b')') {
                                let name = lx.ident();
                                if name.is_empty() {
                                    return Err("bad complex instance".into());
                                }
                                parts.push((name, lx.args()?));
                            }
                            lx.i += 1;
                        } else {
                            let name = lx.ident();
                            if name.is_empty() {
                                return Err("bad instance".into());
                            }
                            parts.push((name, lx.args()?));
                        }
                        if !lx.eat(b';') {
                            return Err("missing ;".into());
                        }
                        Ok(Rec { parts })
                    })();
                    match res {
                        Ok(r) => {
                            recs.insert(id, r);
                        }
                        Err(_) => {
                            lx.skip_instance();
                            bad += 1;
                        }
                    }
                }
                _ => break,
            }
        }
        pos = lx.i;
    }
    if recs.is_empty() {
        return Err("The STEP file has no data".into());
    }
    Ok((File { recs }, bad))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn simple_and_complex_instances() {
        let src = b"ISO-10303-21;\nHEADER;\nFILE_NAME('a','b',(''),(''),'','','');\nENDSEC;\nDATA;\n#1=CARTESIAN_POINT('it''s',(1.,-2.5E1,3));\n#2=( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) );\n/* c */ #3=MEASURE_WITH_UNIT(LENGTH_MEASURE(25.4),#2);\nENDSEC;\nEND-ISO-10303-21;\n";
        let (f, bad) = parse(src).unwrap();
        assert_eq!(bad, 0);
        let (k, a) = f.simple(1).unwrap();
        assert_eq!(k, "CARTESIAN_POINT");
        assert_eq!(a[0], Val::Str("it's".into()));
        assert_eq!(a[1].nums().unwrap(), vec![1.0, -25.0, 3.0]);
        assert!(f.has(2, "LENGTH_UNIT"));
        assert_eq!(f.part(2, "SI_UNIT").unwrap()[0], Val::Enum("MILLI".into()));
        assert_eq!(f.simple(3).unwrap().1[0].num(), Some(25.4));
    }
}
