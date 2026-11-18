//! The queue between the two threads.

use engine_core::spsc::channel;
use std::sync::Arc;
use std::thread;

#[test]
fn keeps_order_and_refuses_when_full() {
    let (mut tx, mut rx) = channel::<u32>(4);
    for i in 0..4 {
        assert_eq!(tx.push(i), Ok(()));
    }
    assert_eq!(tx.push(4), Err(4), "a full queue hands the value back");
    for i in 0..4 {
        assert_eq!(rx.pop(), Some(i));
    }
    assert_eq!(rx.pop(), None);
    assert_eq!(tx.push(9), Ok(()), "room again once read");
    assert_eq!(rx.pop(), Some(9));
}

#[test]
fn carries_a_million_items_between_threads_in_order() {
    let (mut tx, mut rx) = channel::<u64>(256);
    let sender = thread::spawn(move || {
        for i in 0..1_000_000u64 {
            let mut value = i;
            loop {
                match tx.push(value) {
                    Ok(()) => break,
                    Err(back) => {
                        value = back;
                        thread::yield_now();
                    }
                }
            }
        }
    });
    let mut expected = 0u64;
    while expected < 1_000_000 {
        match rx.pop() {
            Some(value) => {
                assert_eq!(value, expected);
                expected += 1;
            }
            None => thread::yield_now(),
        }
    }
    sender.join().unwrap();
    assert_eq!(rx.pop(), None);
}

#[test]
fn frees_what_was_still_inside() {
    let item = Arc::new(5u8);
    let (mut tx, rx) = channel::<Arc<u8>>(8);
    tx.push(item.clone()).unwrap();
    tx.push(item.clone()).unwrap();
    assert_eq!(Arc::strong_count(&item), 3);
    drop(tx);
    drop(rx);
    assert_eq!(Arc::strong_count(&item), 1);
}
