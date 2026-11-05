// Exposes native and WebAssembly entry points for the robotics kernel.





pub mod collision;
pub mod families;
pub mod math;
pub mod mechanism;
pub mod robot;
pub mod rdkfile;
pub mod rdkwrite;
pub mod robotfile;
pub mod station_params;
 
#[cfg(test)]
mod testlib;

use std::cell::RefCell;
use std::collections::HashMap;

thread_local! {
    static MESHES: RefCell<HashMap<u32, collision::Mesh>> = RefCell::new(HashMap::new());
    static NEXT_MESH: RefCell<u32> = const { RefCell::new(1) };
    static RESULT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

unsafe fn slice<'a, T>(ptr: *const T, len: usize) -> &'a [T] {
    if len == 0 || ptr.is_null() {
        &[]
    } else {
        std::slice::from_raw_parts(ptr, len)
    }
}

unsafe fn model_from(ptr: *const f64, len: usize) -> Option<robot::RobotModel> {
    robot::RobotModel::from_flat(slice(ptr, len))
}


#[no_mangle]
pub extern "C" fn rc_alloc(len: usize) -> *mut u8 {
    let words = len.div_ceil(8).max(1);
    let mut v: Vec<u64> = vec![0; words];
    let p = v.as_mut_ptr() as *mut u8;
    std::mem::forget(v);
    p
}


#[no_mangle]
pub unsafe extern "C" fn rc_free(ptr: *mut u8, len: usize) {
    if ptr.is_null() {
        return;
    }
    let words = len.div_ceil(8).max(1);
    drop(Vec::from_raw_parts(ptr as *mut u64, words, words));
}


#[no_mangle]
pub unsafe extern "C" fn rc_fk(model: *const f64, model_len: usize, q: *const f64, out: *mut f64) -> i32 {
    let Some(m) = model_from(model, model_len) else { return 0 };
    let t = m.fk(slice(q, m.dof()));
    std::ptr::copy_nonoverlapping(t.as_ptr(), out, 16);
    1
}


#[no_mangle]
pub unsafe extern "C" fn rc_link_frames(model: *const f64, model_len: usize, q: *const f64, out: *mut f64) -> i32 {
    let Some(m) = model_from(model, model_len) else { return 0 };
    let frames = m.link_frames(slice(q, m.dof()));
    for (i, f) in frames.iter().enumerate() {
        std::ptr::copy_nonoverlapping(f.as_ptr(), out.add(i * 16), 16);
    }
    frames.len() as i32
}


#[no_mangle]
pub unsafe extern "C" fn rc_ik_closest(
    model: *const f64,
    model_len: usize,
    pose: *const f64,
    seed: *const f64,
    out: *mut f64,
) -> i32 {
    let Some(m) = model_from(model, model_len) else { return 0 };
    let mut t = [0.0; 16];
    t.copy_from_slice(slice(pose, 16));
    match m.ik_closest(&t, slice(seed, m.dof())) {
        Some(q) => {
            std::ptr::copy_nonoverlapping(q.as_ptr(), out, q.len());
            1
        }
        None => 0,
    }
}



#[no_mangle]
pub unsafe extern "C" fn rc_ik_track(
    model: *const f64,
    model_len: usize,
    pose: *const f64,
    seed: *const f64,
    out: *mut f64,
) -> i32 {
    let Some(m) = model_from(model, model_len) else { return 0 };
    let mut t = [0.0; 16];
    t.copy_from_slice(slice(pose, 16));
    let s = slice(seed, m.dof()).to_vec();
    match m.ik_numeric(&t, &s, 60) {
        Some(q) if m.within_limits(&q, 1e-6) => {
            std::ptr::copy_nonoverlapping(q.as_ptr(), out, q.len());
            1
        }
        _ => 0,
    }
}



#[no_mangle]
pub unsafe extern "C" fn rc_ik_all(model: *const f64, model_len: usize, pose: *const f64, out: *mut f64, max: i32) -> i32 {
    let Some(m) = model_from(model, model_len) else { return 0 };
    let mut t = [0.0; 16];
    t.copy_from_slice(slice(pose, 16));
    let rows = m.ik_rows(&t, &[]);
    let n = rows.len().min(max.max(0) as usize);
    let w = m.dof() + 1;
    for (i, r) in rows.iter().take(n).enumerate() {
        std::ptr::copy_nonoverlapping(r.q.as_ptr(), out.add(i * w), m.dof());
        *out.add(i * w + m.dof()) = if r.primary { 10.0 } else { 0.0 };
    }
    n as i32
}



pub const IK_ROW_TAIL: usize = 10;




#[no_mangle]
pub unsafe extern "C" fn rc_ik_all_seeded(model: *const f64, model_len: usize, pose: *const f64, seed: *const f64, out: *mut f64, max: i32) -> i32 {
    let Some(m) = model_from(model, model_len) else { return 0 };
    let mut t = [0.0; 16];
    t.copy_from_slice(slice(pose, 16));
    let rows = m.ik_rows(&t, slice(seed, m.dof()));
    let n = rows.len().min(max.max(0) as usize);
    let w = m.dof() + IK_ROW_TAIL;
    for (i, r) in rows.iter().take(n).enumerate() {
        let o = out.add(i * w);
        std::ptr::copy_nonoverlapping(r.q.as_ptr(), o, m.dof());
        *o.add(m.dof()) = if r.primary { 10.0 } else { 0.0 };
        let k = r.extras.len().min(IK_ROW_TAIL - 2);
        *o.add(m.dof() + 1) = k as f64;
        std::ptr::copy_nonoverlapping(r.extras.as_ptr(), o.add(m.dof() + 2), k);
    }
    n as i32
}


#[no_mangle]
pub unsafe extern "C" fn rc_config(model: *const f64, model_len: usize, q: *const f64, out: *mut f64) -> i32 {
    let Some(m) = model_from(model, model_len) else { return 0 };
    let c = m.config(slice(q, m.dof()));
    std::ptr::copy_nonoverlapping(c.as_ptr(), out, 4);
    1
}


#[no_mangle]
pub unsafe extern "C" fn rc_clamp(model: *const f64, model_len: usize, q: *const f64, nq: usize, out: *mut f64) -> i32 {
    let Some(m) = model_from(model, model_len) else { return 0 };
    let c = m.clamp(slice(q, nq));
    std::ptr::copy_nonoverlapping(c.as_ptr(), out, c.len());
    1
}


#[no_mangle]
pub unsafe extern "C" fn rc_within_limits(model: *const f64, model_len: usize, q: *const f64) -> i32 {
    let Some(m) = model_from(model, model_len) else { return 0 };
    m.within_limits(slice(q, m.dof()), 1e-6) as i32
}


#[no_mangle]
pub unsafe extern "C" fn rc_mesh_create(v: *const f32, n_floats: usize) -> u32 {
    let mesh = collision::Mesh::new(slice(v, n_floats));
    let id = NEXT_MESH.with(|n| {
        let mut n = n.borrow_mut();
        let id = *n;
        *n += 1;
        id
    });
    MESHES.with(|m| m.borrow_mut().insert(id, mesh));
    id
}

#[no_mangle]
pub extern "C" fn rc_mesh_free(id: u32) {
    MESHES.with(|m| m.borrow_mut().remove(&id));
}



#[no_mangle]
pub unsafe extern "C" fn rc_collide(a: u32, pose_a: *const f64, b: u32, pose_b: *const f64, clearance: f64) -> i32 {
    let mut pa = [0.0; 16];
    pa.copy_from_slice(slice(pose_a, 16));
    let mut pb = [0.0; 16];
    pb.copy_from_slice(slice(pose_b, 16));
    MESHES.with(|m| {
        let m = m.borrow();
        match (m.get(&a), m.get(&b)) {
            (Some(ma), Some(mb)) => collision::collide(ma, &pa, mb, &pb, clearance) as i32,
            _ => -1,
        }
    })
}



#[no_mangle]
pub unsafe extern "C" fn rc_robotfile_parse(bytes: *const u8, len: usize) -> i32 {
    match robotfile::parse(slice(bytes, len)) {
        Ok(buf) => {
            let n = buf.len() as i32;
            RESULT.with(|r| *r.borrow_mut() = buf);
            n
        }
        Err(e) => {
            let msg = format!("{{\"error\":{}}}", serde_json::to_string(&e).unwrap_or_default());
            RESULT.with(|r| *r.borrow_mut() = msg.into_bytes());
            -1
        }
    }
}

#[no_mangle]
pub extern "C" fn rc_result_ptr() -> *const u8 {
    RESULT.with(|r| r.borrow().as_ptr())
}

#[no_mangle]
pub extern "C" fn rc_result_len() -> usize {
    RESULT.with(|r| r.borrow().len())
}




#[no_mangle]
pub unsafe extern "C" fn rc_rdk_parse(bytes: *const u8, len: usize) -> i32 {
    match rdkfile::parse(slice(bytes, len)) {
        Ok(buf) => {
            let n = buf.len() as i32;
            RESULT.with(|r| *r.borrow_mut() = buf);
            n
        }
        Err(e) => {
            let msg = format!("{{\"error\":{}}}", serde_json::to_string(&e).unwrap_or_default());
            RESULT.with(|r| *r.borrow_mut() = msg.into_bytes());
            -1
        }
    }
}





#[no_mangle]
pub unsafe extern "C" fn rc_rdk_write(json: *const u8, json_len: usize, floats: *const f32, n_floats: usize, day: f64) -> i32 {
    let res = serde_json::from_slice::<serde_json::Value>(slice(json, json_len)).map_err(|e| e.to_string()).and_then(|v| {
        let opts = rdkwrite::Options { version: "Enginuity".into(), platform: "Enginuity".into(), julian_day: day as i64 };
        rdkwrite::write(&v, slice(floats, n_floats), &opts)
    });
    match res {
        Ok((bytes, report)) => {
            let js = serde_json::to_vec(&report).unwrap_or_default();
            let mut buf = Vec::with_capacity(4 + js.len() + bytes.len());
            buf.extend_from_slice(&(js.len() as u32).to_le_bytes());
            buf.extend_from_slice(&js);
            buf.extend_from_slice(&bytes);
            let n = buf.len() as i32;
            RESULT.with(|r| *r.borrow_mut() = buf);
            n
        }
        Err(e) => {
            let msg = format!("{{\"error\":{}}}", serde_json::to_string(&e).unwrap_or_default());
            RESULT.with(|r| *r.borrow_mut() = msg.into_bytes());
            -1
        }
    }
}
