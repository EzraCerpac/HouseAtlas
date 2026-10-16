//! Closed horizontal pick-support/plan agreement, not a general geometry engine.
use super::atlas_scene::{invalid, need};
pub(super) type Point = [f64; 2];
pub(super) type Triangle = [[f64; 3]; 3];
type Edge = [Point; 2];
const EPS: f64 = 0.00001;
const AREA: f64 = EPS * EPS;
const MAX_PAIRS: usize = 2_000_000;
const MAX_SUPPORT: usize = 4096;
const MAX_TOTAL_SUPPORT: usize = 65_536;
#[derive(Default)]
pub(super) struct Work {
    comparisons: usize,
    supports: usize,
}
impl Work {
    fn spend(&mut self, count: usize) -> Result<(), String> {
        self.comparisons = self.comparisons.checked_add(count).ok_or_else(invalid)?;
        need(self.comparisons <= MAX_PAIRS)
    }
    fn product(&mut self, a: usize, b: usize) -> Result<(), String> {
        self.spend(a.checked_mul(b).ok_or_else(invalid)?)
    }
    fn pairs(&mut self, count: usize) -> Result<(), String> {
        self.spend(
            count
                .checked_mul(count.saturating_sub(1))
                .ok_or_else(invalid)?
                / 2,
        )
    }
}
fn cross(a: Point, b: Point, c: Point) -> f64 {
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}
fn length(a: Point, b: Point) -> f64 {
    (a[0] - b[0]).hypot(a[1] - b[1])
}
fn same(a: Point, b: Point) -> bool {
    a == b
}
fn on(point: Point, edge: Edge) -> bool {
    cross(edge[0], edge[1], point) == 0.
        && (0..2).all(|i| {
            point[i] >= edge[0][i].min(edge[1][i]) && point[i] <= edge[0][i].max(edge[1][i])
        })
}
fn intersects(a: Edge, b: Edge) -> bool {
    let ab = [cross(a[0], a[1], b[0]), cross(a[0], a[1], b[1])];
    let ba = [cross(b[0], b[1], a[0]), cross(b[0], b[1], a[1])];
    let opposite = |a: f64, b: f64| (a < 0. && b > 0.) || (a > 0. && b < 0.);
    (opposite(ab[0], ab[1]) && opposite(ba[0], ba[1]))
        || on(a[0], b)
        || on(a[1], b)
        || on(b[0], a)
        || on(b[1], a)
}
fn collinear_overlap([a, b]: Edge, [c, d]: Edge) -> bool {
    if cross(a, b, c) != 0. || cross(a, b, d) != 0. {
        return false;
    }
    let axis = if (b[0] - a[0]).abs() >= (b[1] - a[1]).abs() {
        0
    } else {
        1
    };
    a[axis].max(b[axis]).min(c[axis].max(d[axis])) > a[axis].min(b[axis]).max(c[axis].min(d[axis]))
}
fn edges(ring: &[Point]) -> impl Iterator<Item = Edge> + '_ {
    ring.iter()
        .zip(ring.iter().cycle().skip(1))
        .take(ring.len())
        .map(|(a, b)| [*a, *b])
}
fn area(ring: &[Point]) -> f64 {
    edges(ring).map(|[a, b]| cross(ring[0], a, b)).sum()
}
fn inside(point: Point, ring: &[Point]) -> bool {
    let mut inside = false;
    for edge @ [a, b] in edges(ring) {
        if on(point, edge) {
            return false;
        }
        if (a[1] > point[1]) != (b[1] > point[1])
            && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]
        {
            inside = !inside;
        }
    }
    inside
}
pub(super) fn ring(ring: &[Point], work: &mut Work) -> Result<Vec<Point>, String> {
    // Both common source encodings (open/explicitly closed) have one meaning.
    let ring = if ring.len() > 1 && ring.first() == ring.last() {
        &ring[..ring.len() - 1]
    } else {
        ring
    };
    need(ring.len() >= 3)?;
    work.pairs(ring.len())?;
    need(area(ring).abs() > AREA)?;
    for (i, edge @ [a, b]) in edges(ring).enumerate() {
        need(length(a, b) > 0.)?;
        let c = ring[(i + 2) % ring.len()];
        // Collinear subdivisions are valid; adjacent backtracking is not.
        need(!on(a, [b, c]) && !on(c, [a, b]))?;
        for (j, other) in edges(ring).enumerate().skip(i + 1) {
            if j != i + 1 && !(i == 0 && j == ring.len() - 1) {
                need(!intersects(edge, other))?;
            }
        }
    }
    Ok(ring.to_vec())
}
pub(super) struct Polygon {
    pub outer: Vec<Point>,
    pub holes: Vec<Vec<Point>>,
}
fn separated(a: &[Point], b: &[Point], work: &mut Work) -> Result<(), String> {
    work.product(a.len(), b.len())?;
    for edge in edges(a) {
        for other in edges(b) {
            need(!intersects(edge, other))?;
        }
    }
    Ok(())
}
impl Polygon {
    pub(super) fn validate(&self, work: &mut Work) -> Result<(), String> {
        work.pairs(self.holes.len())?;
        for (i, hole) in self.holes.iter().enumerate() {
            separated(&self.outer, hole, work)?;
            work.spend(self.outer.len())?;
            need(inside(hole[0], &self.outer))?;
            for other in &self.holes[i + 1..] {
                separated(hole, other, work)?;
                work.spend(hole.len() + other.len())?;
                need(!inside(hole[0], other) && !inside(other[0], hole))?;
            }
        }
        Ok(())
    }
    fn rings(&self) -> impl Iterator<Item = &[Point]> {
        std::iter::once(self.outer.as_slice()).chain(self.holes.iter().map(Vec::as_slice))
    }
    fn contains(&self, point: Point) -> bool {
        inside(point, &self.outer) && self.holes.iter().all(|h| !inside(point, h))
    }
}
pub(super) fn disjoint(polygons: &[Polygon], work: &mut Work) -> Result<(), String> {
    work.pairs(polygons.len())?;
    for (i, polygon) in polygons.iter().enumerate() {
        for other in &polygons[i + 1..] {
            work.product(1 + polygon.holes.len(), 1 + other.holes.len())?;
            for a in polygon.rings() {
                for b in other.rings() {
                    separated(a, b, work)?;
                }
            }
            work.spend(
                polygon.rings().map(<[Point]>::len).sum::<usize>()
                    + other.rings().map(<[Point]>::len).sum::<usize>(),
            )?;
            need(!polygon.contains(other.outer[0]) && !other.contains(polygon.outer[0]))?;
        }
    }
    Ok(())
}
#[derive(Default)]
pub(super) struct Support {
    minimum_y: Option<f64>,
    triangles: Vec<Triangle>,
}
impl Support {
    pub(super) fn begin(&mut self, minimum_y: f64) {
        self.minimum_y = Some(self.minimum_y.map_or(minimum_y, |v| v.min(minimum_y)));
    }
    pub(super) fn triangle(&mut self, triangle: Triangle, work: &mut Work) -> Result<bool, String> {
        let a = std::array::from_fn::<_, 3, _>(|i| triangle[1][i] - triangle[0][i]);
        let b = std::array::from_fn::<_, 3, _>(|i| triangle[2][i] - triangle[0][i]);
        let normal = [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0],
        ];
        let positive = normal.into_iter().map(|v| v * v).sum::<f64>() > AREA * AREA;
        let minimum_y = self.minimum_y.ok_or_else(invalid)?;
        if positive
            && triangle.iter().all(|p| (p[1] - minimum_y).abs() <= EPS)
            && cross(
                [triangle[0][0], triangle[0][2]],
                [triangle[1][0], triangle[1][2]],
                [triangle[2][0], triangle[2][2]],
            )
            .abs()
                > AREA
        {
            need(self.triangles.len() < MAX_SUPPORT && work.supports < MAX_TOTAL_SUPPORT)?;
            work.supports += 1;
            self.triangles.push(triangle);
        }
        Ok(positive)
    }
    pub(super) fn matches(&self, polygons: &[Polygon], work: &mut Work) -> Result<(), String> {
        let minimum_y = self.minimum_y.ok_or_else(invalid)?;
        let triangles: Vec<[Point; 3]> = self
            .triangles
            .iter()
            .filter(|t| t.iter().all(|p| (p[1] - minimum_y).abs() <= EPS))
            .map(|t| {
                let mut t = t.map(|p| [p[0], p[2]]);
                if cross(t[0], t[1], t[2]) < 0. {
                    t.swap(1, 2);
                }
                t
            })
            .collect();
        need(!triangles.is_empty() && !polygons.is_empty())?;
        work.pairs(triangles.len())?;
        for (i, triangle) in triangles.iter().enumerate() {
            need(edges(triangle).all(|[a, b]| length(a, b) > 0.))?;
            for other in &triangles[i + 1..] {
                need(overlap(*triangle, *other) <= AREA)?;
            }
        }
        let count = triangles.len().checked_mul(3).ok_or_else(invalid)?;
        work.pairs(count)?;
        let mesh_edges: Vec<Edge> = triangles.iter().flat_map(|t| edges(t)).collect();
        let mut partners = vec![None; count];
        for (i, edge) in mesh_edges.iter().enumerate() {
            for (j, other) in mesh_edges.iter().enumerate().skip(i + 1) {
                need(!(same(edge[0], other[0]) && same(edge[1], other[1])))?;
                if same(edge[0], other[1]) && same(edge[1], other[0]) {
                    need(partners[i].is_none() && partners[j].is_none())?;
                    partners[i] = Some(j);
                    partners[j] = Some(i);
                } else {
                    // Partial interior seams cannot masquerade as a plan hole.
                    // The closed support triangulation requires whole edge joins.
                    need(!collinear_overlap(*edge, *other))?;
                }
            }
        }
        let boundary: Vec<Edge> = mesh_edges
            .into_iter()
            .zip(partners)
            .filter_map(|(e, p)| p.is_none().then_some(e))
            .collect();
        let cycles = boundary_cycles(&boundary, work)?;
        let cycle_areas: Vec<f64> = cycles.iter().map(|r| area(r)).collect();
        work.pairs(cycles.len())?;
        for (i, cycle) in cycles.iter().enumerate() {
            for other in &cycles[i + 1..] {
                separated(cycle, other, work)?;
            }
        }
        // Every clockwise void belongs to its immediate containing filled outer.
        // Distinct nearby vertices stay distinct; correspondence never welds them.
        work.product(cycles.len(), cycles.len())?;
        let mut parents = vec![None; cycles.len()];
        for (i, cycle) in cycles.iter().enumerate() {
            if cycle_areas[i] > 0. {
                continue;
            }
            for (j, outer) in cycles.iter().enumerate() {
                if cycle_areas[j] <= 0. {
                    continue;
                }
                work.spend(outer.len())?;
                if inside(cycle[0], outer) {
                    if let Some(parent) = parents[i] {
                        need(cycle_areas[parent] != cycle_areas[j])?;
                        if cycle_areas[parent] < cycle_areas[j] {
                            continue;
                        }
                    }
                    parents[i] = Some(j);
                }
            }
            need(parents[i].is_some())?;
        }
        let mut plan_rings = Vec::new();
        for polygon in polygons {
            let outer = plan_rings.len();
            plan_rings.push((polygon.outer.as_slice(), true, None));
            for hole in &polygon.holes {
                plan_rings.push((hole.as_slice(), false, Some(outer)));
            }
        }
        need(cycles.len() == plan_rings.len())?;
        work.product(plan_rings.len(), cycles.len())?;
        let mut mapping = Vec::new();
        let mut used = vec![false; cycles.len()];
        for (plan, positive, _) in &plan_rings {
            let mut matched = None;
            for (i, cycle) in cycles.iter().enumerate() {
                if (cycle_areas[i] > 0.) != *positive {
                    continue;
                }
                work.product(plan.len(), cycle.len())?;
                work.product(cycle.len(), plan.len())?;
                let reverse = (area(plan) > 0.) != *positive;
                let plan_edges: Vec<Edge> = edges(plan)
                    .map(|[a, b]| if reverse { [b, a] } else { [a, b] })
                    .collect();
                let cycle_edges: Vec<Edge> = edges(cycle).collect();
                if plan_edges.iter().all(|e| covered(*e, &cycle_edges))
                    && cycle_edges.iter().all(|e| covered(*e, &plan_edges))
                {
                    need(matched.is_none())?;
                    matched = Some(i);
                }
            }
            let matched = matched.ok_or_else(invalid)?;
            need(!used[matched])?;
            used[matched] = true;
            mapping.push(matched);
        }
        for (i, (_, _, outer)) in plan_rings.iter().enumerate() {
            if let Some(outer) = outer {
                need(parents[mapping[i]] == Some(mapping[*outer]))?;
            }
        }
        Ok(())
    }
}
// A conforming directed boundary has one incoming and outgoing edge at every
// exact vertex. Keep every cycle, including small ones, and validate its area.
fn boundary_cycles(boundary: &[Edge], work: &mut Work) -> Result<Vec<Vec<Point>>, String> {
    work.product(boundary.len(), boundary.len())?;
    let mut next = vec![None; boundary.len()];
    let mut previous = vec![None; boundary.len()];
    for (i, edge) in boundary.iter().enumerate() {
        for (j, other) in boundary.iter().enumerate() {
            if same(edge[1], other[0]) {
                need(next[i].is_none() && previous[j].is_none())?;
                next[i] = Some(j);
                previous[j] = Some(i);
            }
        }
    }
    need(next.iter().all(Option::is_some) && previous.iter().all(Option::is_some))?;
    work.spend(boundary.len())?;
    let mut visited = vec![false; boundary.len()];
    let mut cycles = Vec::new();
    for start in 0..boundary.len() {
        if visited[start] {
            continue;
        }
        let mut current = start;
        let mut points = Vec::new();
        loop {
            need(!visited[current])?;
            visited[current] = true;
            points.push(boundary[current][0]);
            current = next[current].ok_or_else(invalid)?;
            if current == start {
                break;
            }
        }
        cycles.push(ring(&points, work)?);
    }
    Ok(cycles)
}
// Convex triangle intersection is used only to refuse overlapping support
// triangles. At most six vertices survive; no arbitrary polygon boolean exists.
fn overlap(a: [Point; 3], b: [Point; 3]) -> f64 {
    let mut points = [[0.; 2]; 8];
    points[..3].copy_from_slice(&a);
    let mut count = 3;
    for [start, end] in edges(&b) {
        let input = points;
        let input_count = count;
        count = 0;
        for i in 0..input_count {
            let p = input[i];
            let q = input[(i + 1) % input_count];
            let cp = cross(start, end, p);
            let cq = cross(start, end, q);
            if cp >= 0. && (count == 0 || points[count - 1] != p) {
                if count == points.len() {
                    return f64::INFINITY;
                }
                points[count] = p;
                count += 1;
            }
            if (cp >= 0.) != (cq >= 0.) {
                let t = cp / (cp - cq);
                let point = [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])];
                if count == 0 || points[count - 1] != point {
                    if count == points.len() {
                        return f64::INFINITY;
                    }
                    points[count] = point;
                    count += 1;
                }
            }
        }
        if count > 1 && points[0] == points[count - 1] {
            count -= 1;
        }
        if count < 3 {
            return 0.;
        }
    }
    area(&points[..count]).abs()
}
fn covered([a, b]: Edge, candidates: &[Edge]) -> bool {
    let size = length(a, b);
    let axis = if (b[0] - a[0]).abs() >= (b[1] - a[1]).abs() {
        0
    } else {
        1
    };
    let mut intervals = Vec::new();
    for [c, d] in candidates {
        // Both boundaries put filled space on the left. Direction distinguishes
        // an empty courtyard from an extra filled island with the same outline.
        if (b[0] - a[0]) * (d[0] - c[0]) + (b[1] - a[1]) * (d[1] - c[1]) > 0.
            && cross(a, b, *c).abs() <= EPS * size
            && cross(a, b, *d).abs() <= EPS * size
        {
            let t = [
                (c[axis] - a[axis]) / (b[axis] - a[axis]),
                (d[axis] - a[axis]) / (b[axis] - a[axis]),
            ];
            let low = t[0].min(t[1]).max(0.);
            let high = t[0].max(t[1]).min(1.);
            if high > low {
                intervals.push((low, high));
            }
        }
    }
    if intervals.is_empty() {
        return false;
    }
    intervals.sort_by(|a, b| a.0.total_cmp(&b.0));
    let tolerance = EPS / size;
    let mut end: f64 = 0.;
    for (low, high) in intervals {
        if low > end + tolerance {
            return false;
        }
        end = end.max(high);
    }
    end >= 1. - tolerance
}
