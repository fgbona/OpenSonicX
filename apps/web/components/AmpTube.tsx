/**
 * The power tube on the AMP faceplate: an AI-generated illustration made for this project by its
 * owner, on black, screened onto the plate so only the glass and the glowing heater show.
 */
export function AmpTube() {
  return (
    <span className="amp-tube" aria-hidden="true">
      <img src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/amp-tube.png`} alt="" width={200} height={344} />
    </span>
  );
}
