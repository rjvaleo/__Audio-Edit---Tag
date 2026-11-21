//! Stable, bounded waiting messages. The message's public seq is not its age:
//! internally scheduled After messages all have seq zero.
use super::Stamped;
use std::cmp::Ordering;
use std::collections::BinaryHeap;

struct Waiting {
    message: Stamped,
    order: u64,
}
impl PartialEq for Waiting {
    fn eq(&self, other: &Self) -> bool {
        (self.message.frame, self.order) == (other.message.frame, other.order)
    }
}
impl Eq for Waiting {}
impl PartialOrd for Waiting {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for Waiting {
    fn cmp(&self, other: &Self) -> Ordering {
        // BinaryHeap is a max heap; the earliest frame and insertion win.
        (other.message.frame, other.order).cmp(&(self.message.frame, self.order))
    }
}

pub(super) struct Pending {
    heap: BinaryHeap<Waiting>,
    next: u64,
    room: usize,
    boundary: Option<u64>,
}
impl Pending {
    pub(super) fn new(room: usize) -> Self {
        Self {
            heap: BinaryHeap::with_capacity(room),
            next: 0,
            room,
            boundary: None,
        }
    }
    pub(super) fn len(&self) -> usize {
        self.heap.len()
    }
    pub(super) fn boundary(&self) -> Option<u64> { self.boundary }
    pub(super) fn first(&self) -> Option<&Stamped> {
        self.heap.peek().map(|w| &w.message)
    }
    pub(super) fn pop(&mut self) -> Option<Stamped> {
        self.heap.pop().map(|w| {
            if !matches!(w.message.msg, super::Msg::Event { .. }) {
                self.boundary = self.heap.iter().filter(|w| !matches!(w.message.msg, super::Msg::Event { .. }))
                    .map(|w| w.message.frame).min();
            }
            w.message
        })
    }
    pub(super) fn push(&mut self, message: Stamped) {
        assert!(
            self.len() < self.room,
            "waiting messages exceed their prepared room"
        );
        if self.next == u64::MAX {
            // Preserve insertion ranks at counter rollover without allocating.
            // This happens once per 2^64 insertions, not once per callback.
            let mut entries = std::mem::take(&mut self.heap).into_vec();
            entries.sort_unstable_by_key(|w| w.order);
            for (order, entry) in entries.iter_mut().enumerate() {
                entry.order = order as u64;
            }
            self.next = entries.len() as u64;
            self.heap = BinaryHeap::from(entries);
        }
        if !matches!(message.msg, super::Msg::Event { .. }) {
            self.boundary = Some(self.boundary.map_or(message.frame, |old| old.min(message.frame)));
        }
        let order = self.next;
        self.next += 1;
        self.heap.push(Waiting { message, order });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::Msg;
    use crate::module::EventKind;
    fn event(frame: u64, seq: u64, id: u32) -> Stamped {
        Stamped {
            frame,
            seq,
            msg: Msg::Event {
                module: id,
                kind: EventKind::Param {
                    index: 0,
                    value: id as f32,
                },
            },
        }
    }
    fn id(message: Stamped) -> u32 {
        match message.msg {
            Msg::Event { module, .. } => module,
            _ => unreachable!(),
        }
    }
    #[test]
    fn insertion_order_is_independent_of_public_sequence_numbers() {
        let mut queue = Pending::new(4);
        queue.push(event(8, 99, 1));
        queue.push(event(3, 0, 2));
        queue.push(event(8, 0, 3));
        queue.push(event(8, 1, 4));
        assert_eq!(
            (0..4).map(|_| id(queue.pop().unwrap())).collect::<Vec<_>>(),
            [2, 1, 3, 4]
        );
    }
    #[test]
    fn after_messages_share_the_same_insertion_order() {
        let mut queue = Pending::new(3);
        queue.push(event(8, 90, 1));
        queue.push(Stamped {
            frame: 8,
            seq: 0,
            msg: Msg::After(Box::new(crate::plan::Plan::empty(128))),
        });
        queue.push(event(8, 1, 2));
        assert_eq!(id(queue.pop().unwrap()), 1);
        assert!(matches!(queue.pop().unwrap().msg, Msg::After(_)));
        assert_eq!(id(queue.pop().unwrap()), 2);
    }
    #[test]
    fn counter_rollover_keeps_live_insertion_order_and_capacity() {
        let mut queue = Pending::new(4);
        queue.next = u64::MAX - 2;
        queue.push(event(8, 0, 1));
        queue.push(event(3, 0, 2));
        queue.push(event(8, 0, 3));
        queue.push(event(8, 0, 4));
        assert_eq!(queue.heap.capacity(), 4);
        assert_eq!(
            (0..4).map(|_| id(queue.pop().unwrap())).collect::<Vec<_>>(),
            [2, 1, 3, 4]
        );
    }
}
