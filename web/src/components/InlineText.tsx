/** `백틱` 으로 감싼 부분만 <code> 로 보여 준다. HTML 은 해석하지 않는다. */
export function InlineText({ text }: { text: string }) {
  const parts = text.split(/`([^`]+)`/);
  return (
    <>
      {parts.map((p, i) => (i % 2 === 1 ? <code key={i}>{p}</code> : <span key={i}>{p}</span>))}
    </>
  );
}
