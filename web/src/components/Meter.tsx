
export default function Meter() {
  const centimetros = Array.from({ length: 101 }, (_, i) => i);

  return (
    <div className="meter">
      {centimetros.map((cm) => (
        <div className="meter-mark" key={cm}>
          <span
            className={`line ${cm % 5 === 0 ? "line-long" : ""}`}
          />

          {cm % 5 === 0 && (
            <span className="meter-label">{cm}</span>
          )}
        </div>
      ))}
    </div>
  );
}

