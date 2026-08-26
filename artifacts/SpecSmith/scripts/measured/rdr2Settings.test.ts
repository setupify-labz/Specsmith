import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import path from 'node:path';

import {
  Rdr2SettingsAmbiguousLocationError,
  Rdr2SettingsFormatError,
  Rdr2SettingsNotFoundError,
  candidateRdr2SettingsPaths,
  locateRdr2SettingsFile,
  parseRdr2SystemSettingsXml,
  readRdr2SystemSettings,
  RDR2_GRAPHICS_APIS,
  RDR2_QUALITY_LEVELS,
  type ReadFsLike,
} from './rdr2Settings';

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

/**
 * A real, complete RDR2 system.xml, pinned verbatim from a long-running
 * community parser project built specifically to read this file:
 * https://github.com/Forceflow/rdr2_settings_parser/blob/main/system.xml
 * (fetched into this fixture; not regenerated or guessed at). The doubled
 * "NVIDIA NVIDIA" in videoCardDescription is the game's own real output, not
 * a fixture typo, and is preserved deliberately — this parser does not clean
 * up or reinterpret anything it reads.
 */
const REAL_SYSTEM_XML = `<?xml version="1.0" encoding="UTF-8"?>

<rage__fwuiSystemSettingsCollection>
  <version value="37" />
  <configSource>kSettingsConfig_Auto</configSource>
  <graphics>
    <tessellation>kSettingLevel_High</tessellation>
    <shadowQuality>kSettingLevel_High</shadowQuality>
    <farShadowQuality>kSettingLevel_High</farShadowQuality>
    <reflectionQuality>kSettingLevel_Medium</reflectionQuality>
    <mirrorQuality>kSettingLevel_High</mirrorQuality>
    <ssao>kSettingLevel_High</ssao>
    <textureQuality>kSettingLevel_Ultra</textureQuality>
    <particleQuality>kSettingLevel_High</particleQuality>
    <waterQuality>kSettingLevel_Custom</waterQuality>
    <volumetricsQuality>kSettingLevel_High</volumetricsQuality>
    <lightingQuality>kSettingLevel_High</lightingQuality>
    <ambientLightingQuality>kSettingLevel_High</ambientLightingQuality>
    <anisotropicFiltering value="4" />
    <dlssIndex value="2" />
    <dlssQuality value="2" />
    <taa>kSettingLevel_High</taa>
    <fxaaEnabled value="false" />
    <msaa value="0" />
    <graphicsQualityPreset value="0.500000" />
    <hdr value="true" />
    <hdrIntensity value="100" />
    <hdrPeakBrightness value="1000" />
    <hdrFilmicMode value="true" />
    <gamma value="15" />
    <hdrSettingsMigrated value="true" />
  </graphics>
  <advancedGraphics>
    <API>kSettingAPI_Vulkan</API>
    <locked value="false" />
    <asyncComputeEnabled value="false" />
    <transferQueuesEnabled value="true" />
    <shadowSoftShadows>kSettingLevel_High</shadowSoftShadows>
    <motionBlur value="true" />
    <motionBlurLimit value="16.000000" />
    <particleLightingQuality>kSettingLevel_Medium</particleLightingQuality>
    <waterReflectionSSR value="true" />
    <waterRefractionQuality>kSettingLevel_Medium</waterRefractionQuality>
    <waterReflectionQuality>kSettingLevel_High</waterReflectionQuality>
    <waterSimulationQuality value="2" />
    <waterLightingQuality>kSettingLevel_High</waterLightingQuality>
    <furDisplayQuality>kSettingLevel_High</furDisplayQuality>
    <maxTexUpgradesPerFrame value="5" />
    <shadowGrassShadows>kSettingLevel_Medium</shadowGrassShadows>
    <shadowParticleShadows value="true" />
    <shadowLongShadows value="true" />
    <directionalShadowsAlpha value="false" />
    <worldHeightShadowQuality value="0.660000" />
    <directionalScreenSpaceShadowQuality value="0.660000" />
    <ambientMaskVolumesHighPrecision value="true" />
    <scatteringVolumeQuality>kSettingLevel_High</scatteringVolumeQuality>
    <volumetricsRaymarchQuality>kSettingLevel_High</volumetricsRaymarchQuality>
    <volumetricsLightingQuality>kSettingLevel_High</volumetricsLightingQuality>
    <volumetricsRaymarchResolutionUnclamped value="false" />
    <terrainShadowQuality>kSettingLevel_High</terrainShadowQuality>
    <damageModelsDisabled value="false" />
    <decalQuality>kSettingLevel_High</decalQuality>
    <ssaoFullScreenEnabled value="false" />
    <ssaoType value="0" />
    <ssdoSampleCount value="4" />
    <ssdoUseDualRadii value="false" />
    <ssdoResolution>kSettingLevel_Low</ssdoResolution>
    <ssdoTAABlendEnabled value="true" />
    <ssroSampleCount value="2" />
    <snowGlints value="true" />
    <POMQuality>kSettingLevel_High</POMQuality>
    <probeRelightEveryFrame value="false" />
    <scalingMode>kSettingScale_Mode1o1</scalingMode>
    <reflectionMSAA value="0" />
    <lodScale value="1.000000" />
    <grassLod value="2.250000" />
    <pedLodBias value="0.000000" />
    <vehicleLodBias value="0.000000" />
    <sharpenIntensity value="4.000000" />
    <treeQuality>kSettingLevel_High</treeQuality>
    <deepsurfaceQuality>kSettingLevel_High</deepsurfaceQuality>
    <treeTessellationEnabled value="false" />
  </advancedGraphics>
  <video>
    <adapterIndex value="0" />
    <outputIndex value="0" />
    <resolutionIndex value="15" />
    <screenWidth value="1920" />
    <screenHeight value="1080" />
    <resolutionIndexWindowed value="13" />
    <screenWidthWindowed value="1920" />
    <screenHeightWindowed value="1080" />
    <refreshRateIndex value="5" />
    <refreshRateNumerator value="144" />
    <refreshRateDenominator value="1" />
    <windowed value="2" />
    <vSync value="0" />
    <tripleBuffered value="false" />
    <pauseOnFocusLoss value="false" />
    <constrainMousePointer value="false" />
  </video>
  <videoCardDescription>NVIDIA NVIDIA GeForce RTX 2070 SUPER</videoCardDescription>
</rage__fwuiSystemSettingsCollection>
`;

// ---------------------------------------------------------------------------
// parseRdr2SystemSettingsXml
// ---------------------------------------------------------------------------

describe('parsing a real system.xml', () => {
  it('extracts every known field with its exact value', () => {
    const parsed = parseRdr2SystemSettingsXml(REAL_SYSTEM_XML);
    expect(parsed).toEqual({
      schemaVersion: 37,
      videoCardDescription: 'NVIDIA NVIDIA GeForce RTX 2070 SUPER',
      display: {
        screenWidth: 1920,
        screenHeight: 1080,
        screenWidthWindowed: 1920,
        screenHeightWindowed: 1080,
        windowed: 2,
        vSync: 0,
      },
      graphics: {
        textureQuality: 'kSettingLevel_Ultra',
        shadowQuality: 'kSettingLevel_High',
        reflectionQuality: 'kSettingLevel_Medium',
        taa: 'kSettingLevel_High',
        api: 'kSettingAPI_Vulkan',
      },
    });
  });

  // The doubled "NVIDIA NVIDIA" is real output from the game itself — this
  // parser must not clean it up, since doing so would be exactly the kind of
  // silent reinterpretation the rest of this collector refuses to do.
  it('preserves videoCardDescription verbatim, including its real-world oddities', () => {
    expect(parseRdr2SystemSettingsXml(REAL_SYSTEM_XML).videoCardDescription).toBe(
      'NVIDIA NVIDIA GeForce RTX 2070 SUPER',
    );
  });
});

describe('rejecting missing, malformed, conflicting or unknown critical settings', () => {
  it('rejects an empty file', () => {
    expect(() => parseRdr2SystemSettingsXml('')).toThrow(Rdr2SettingsFormatError);
    expect(() => parseRdr2SystemSettingsXml('   \n  ')).toThrow(/empty/);
  });

  it('rejects a document whose root element is not the recognized one', () => {
    const wrongRoot = REAL_SYSTEM_XML.replace(
      /rage__fwuiSystemSettingsCollection/g,
      'someOtherGamesSettings',
    );
    expect(() => parseRdr2SystemSettingsXml(wrongRoot)).toThrow(Rdr2SettingsFormatError);
    expect(() => parseRdr2SystemSettingsXml(wrongRoot)).toThrow(/top-level element/);
  });

  it('rejects a completely unrelated XML document', () => {
    expect(() => parseRdr2SystemSettingsXml('<?xml version="1.0"?><html><body>not this</body></html>')).toThrow(
      /top-level element/,
    );
  });

  it('rejects when a required tag is missing entirely', () => {
    const missingTexture = REAL_SYSTEM_XML.replace(
      '<textureQuality>kSettingLevel_Ultra</textureQuality>',
      '',
    );
    expect(() => parseRdr2SystemSettingsXml(missingTexture)).toThrow(Rdr2SettingsFormatError);
    expect(() => parseRdr2SystemSettingsXml(missingTexture)).toThrow(/Missing required <textureQuality>/);
  });

  it('rejects when the top-level schema version is missing', () => {
    const missingVersion = REAL_SYSTEM_XML.replace('<version value="37" />', '');
    expect(() => parseRdr2SystemSettingsXml(missingVersion)).toThrow(/Missing required <version>/);
  });

  // A tag appearing twice is CONFLICTING, not "last one wins" or "first one
  // wins" — this parser cannot know which value the game actually used.
  it('rejects a critical setting that appears more than once, as a conflict rather than picking one', () => {
    const duplicated = REAL_SYSTEM_XML.replace(
      '<textureQuality>kSettingLevel_Ultra</textureQuality>',
      '<textureQuality>kSettingLevel_Ultra</textureQuality>\n    <textureQuality>kSettingLevel_Low</textureQuality>',
    );
    expect(() => parseRdr2SystemSettingsXml(duplicated)).toThrow(Rdr2SettingsFormatError);
    expect(() => parseRdr2SystemSettingsXml(duplicated)).toThrow(/appears 2 times/);
  });

  it('rejects a duplicated numeric value-attribute setting the same way', () => {
    const duplicated = REAL_SYSTEM_XML.replace(
      '<screenWidth value="1920" />',
      '<screenWidth value="1920" />\n    <screenWidth value="2560" />',
    );
    expect(() => parseRdr2SystemSettingsXml(duplicated)).toThrow(/<screenWidth> appears 2 times/);
  });

  // The core "never guess" property: a plausible-looking but never-verified
  // enum value is refused outright, not coerced to the nearest known level.
  it('rejects an unrecognized quality-level value instead of guessing the nearest known one', () => {
    const unknownLevel = REAL_SYSTEM_XML.replace(
      '<textureQuality>kSettingLevel_Ultra</textureQuality>',
      '<textureQuality>kSettingLevel_VeryHigh</textureQuality>',
    );
    expect(() => parseRdr2SystemSettingsXml(unknownLevel)).toThrow(Rdr2SettingsFormatError);
    expect(() => parseRdr2SystemSettingsXml(unknownLevel)).toThrow(/not one of the values this parser recognizes/);
  });

  it('rejects an unrecognized graphics API instead of assuming DX11', () => {
    const dx11 = REAL_SYSTEM_XML.replace('<API>kSettingAPI_Vulkan</API>', '<API>kSettingAPI_DX11</API>');
    expect(() => parseRdr2SystemSettingsXml(dx11)).toThrow(/not one of the values this parser recognizes/);
  });

  it('accepts the other independently-confirmed API value', () => {
    const dx12 = REAL_SYSTEM_XML.replace('<API>kSettingAPI_Vulkan</API>', '<API>kSettingAPI_DX12</API>');
    expect(parseRdr2SystemSettingsXml(dx12).graphics.api).toBe('kSettingAPI_DX12');
  });

  it('rejects a screen dimension that is zero, negative, or non-numeric', () => {
    expect(() =>
      parseRdr2SystemSettingsXml(REAL_SYSTEM_XML.replace('<screenWidth value="1920" />', '<screenWidth value="0" />')),
    ).toThrow(/not a positive whole number/);
    expect(() =>
      parseRdr2SystemSettingsXml(REAL_SYSTEM_XML.replace('<screenWidth value="1920" />', '<screenWidth value="-1" />')),
    ).toThrow(/not a positive whole number/);
    expect(() =>
      parseRdr2SystemSettingsXml(REAL_SYSTEM_XML.replace('<screenWidth value="1920" />', '<screenWidth value="wide" />')),
    ).toThrow(/not a positive whole number/);
  });

  it('rejects a vSync or windowed code outside the known set, rather than assuming its meaning', () => {
    expect(() =>
      parseRdr2SystemSettingsXml(REAL_SYSTEM_XML.replace('<vSync value="0" />', '<vSync value="9" />')),
    ).toThrow(/not one of the values this parser recognizes/);
    expect(() =>
      parseRdr2SystemSettingsXml(REAL_SYSTEM_XML.replace('<windowed value="2" />', '<windowed value="9" />')),
    ).toThrow(/not one of the values this parser recognizes/);
  });

  it('rejects an empty videoCardDescription', () => {
    const empty = REAL_SYSTEM_XML.replace(
      '<videoCardDescription>NVIDIA NVIDIA GeForce RTX 2070 SUPER</videoCardDescription>',
      '<videoCardDescription></videoCardDescription>',
    );
    expect(() => parseRdr2SystemSettingsXml(empty)).toThrow(/present but empty/);
  });

  it('does not confuse a windowed-mode field with its fullscreen counterpart of a similar name', () => {
    // screenWidthWindowed must never satisfy a search for screenWidth, even
    // though one name is a prefix of the other.
    const onlyWindowedVariant = REAL_SYSTEM_XML.replace('<screenWidth value="1920" />', '');
    expect(() => parseRdr2SystemSettingsXml(onlyWindowedVariant)).toThrow(/Missing required <screenWidth>/);
  });
});

// ---------------------------------------------------------------------------
// Genuine well-formedness validation — not just "the regex didn't match"
// ---------------------------------------------------------------------------
//
// These prove the tokenizer in parseXmlElements actually walks the document
// structurally, rather than the first version's approach of searching raw
// text for each known tag independently — which could not tell a real tag
// from one sitting in a comment, outside the root, or inside an otherwise
// broken document.

describe('hardening against structurally malformed XML', () => {
  it('rejects a document missing its closing root tag', () => {
    const truncated = REAL_SYSTEM_XML.replace('</rage__fwuiSystemSettingsCollection>\n', '');
    expect(() => parseRdr2SystemSettingsXml(truncated)).toThrow(Rdr2SettingsFormatError);
    expect(() => parseRdr2SystemSettingsXml(truncated)).toThrow(/Unclosed element/);
  });

  it('rejects a document truncated mid-element, not just at the very end', () => {
    // Cuts off partway through <advancedGraphics>, well before the root closes.
    const cutoff = REAL_SYSTEM_XML.slice(0, REAL_SYSTEM_XML.indexOf('<advancedGraphics>') + 50);
    expect(() => parseRdr2SystemSettingsXml(cutoff)).toThrow(Rdr2SettingsFormatError);
  });

  it('rejects a mismatched closing tag instead of pairing it with the wrong element', () => {
    const mismatched = REAL_SYSTEM_XML.replace(
      '<textureQuality>kSettingLevel_Ultra</textureQuality>',
      '<textureQuality>kSettingLevel_Ultra</shadowQuality>',
    );
    expect(() => parseRdr2SystemSettingsXml(mismatched)).toThrow(Rdr2SettingsFormatError);
    expect(() => parseRdr2SystemSettingsXml(mismatched)).toThrow(/Mismatched closing tag/);
  });

  it('rejects a required tag placed after the root element already closed', () => {
    const trailing = `${REAL_SYSTEM_XML}<textureQuality>kSettingLevel_Ultra</textureQuality>`;
    expect(() => parseRdr2SystemSettingsXml(trailing)).toThrow(Rdr2SettingsFormatError);
    expect(() => parseRdr2SystemSettingsXml(trailing)).toThrow(/already closed/);
  });

  it('rejects a required tag placed before the root element opens', () => {
    const leading = `<textureQuality>kSettingLevel_Ultra</textureQuality>${REAL_SYSTEM_XML}`;
    expect(() => parseRdr2SystemSettingsXml(leading)).toThrow(Rdr2SettingsFormatError);
    expect(() => parseRdr2SystemSettingsXml(leading)).toThrow(/top-level element/);
  });

  it('rejects a comment containing what looks like a real required tag, when the real tag is absent', () => {
    const commentedOut = REAL_SYSTEM_XML.replace(
      '<textureQuality>kSettingLevel_Ultra</textureQuality>',
      '<!-- <textureQuality>kSettingLevel_Ultra</textureQuality> -->',
    );
    expect(() => parseRdr2SystemSettingsXml(commentedOut)).toThrow(Rdr2SettingsFormatError);
    expect(() => parseRdr2SystemSettingsXml(commentedOut)).toThrow(/Missing required <textureQuality>/);
  });

  it('does not let a commented-out DIFFERENT value shadow the real one', () => {
    const withDecoyComment = REAL_SYSTEM_XML.replace(
      '<textureQuality>kSettingLevel_Ultra</textureQuality>',
      '<textureQuality>kSettingLevel_Ultra</textureQuality>\n    <!-- <textureQuality>kSettingLevel_Low</textureQuality> -->',
    );
    expect(parseRdr2SystemSettingsXml(withDecoyComment).graphics.textureQuality).toBe('kSettingLevel_Ultra');
  });

  it('rejects an unquoted attribute value', () => {
    const unquoted = REAL_SYSTEM_XML.replace('<screenWidth value="1920" />', '<screenWidth value=1920 />');
    expect(() => parseRdr2SystemSettingsXml(unquoted)).toThrow(Rdr2SettingsFormatError);
    expect(() => parseRdr2SystemSettingsXml(unquoted)).toThrow(/Malformed XML/);
  });

  it('rejects a single-quoted attribute value (this parser only recognizes double quotes, matching every real file seen)', () => {
    const singleQuoted = REAL_SYSTEM_XML.replace('<screenWidth value="1920" />', "<screenWidth value='1920' />");
    expect(() => parseRdr2SystemSettingsXml(singleQuoted)).toThrow(/Malformed XML/);
  });

  it('rejects an unterminated attribute value rather than reading past it', () => {
    const unterminated = REAL_SYSTEM_XML.replace('<screenWidth value="1920" />', '<screenWidth value="1920 />\n  <video>');
    expect(() => parseRdr2SystemSettingsXml(unterminated)).toThrow(/Malformed XML/);
  });

  it('rejects a stray, unescaped "<" that starts nothing recognizable', () => {
    const stray = REAL_SYSTEM_XML.replace('<screenWidth value="1920" />', '< screenWidth value="1920" />');
    expect(() => parseRdr2SystemSettingsXml(stray)).toThrow(/Malformed XML/);
  });

  it('rejects CDATA content appearing outside the root element', () => {
    const cdataOutside = `${REAL_SYSTEM_XML}<![CDATA[not real content]]>`;
    expect(() => parseRdr2SystemSettingsXml(cdataOutside)).toThrow(Rdr2SettingsFormatError);
  });

  it('is unaffected by an XML comment appearing in an otherwise valid position', () => {
    const withRealComment = REAL_SYSTEM_XML.replace(
      '<graphics>',
      '<graphics>\n    <!-- this is a real, harmless comment -->',
    );
    const parsed = parseRdr2SystemSettingsXml(withRealComment);
    expect(parsed.graphics.textureQuality).toBe('kSettingLevel_Ultra');
  });
});

// ---------------------------------------------------------------------------
// Two more conflict cases: a duplicate the earlier version silently accepted
// ---------------------------------------------------------------------------
//
// Both of these previously PASSED — parseRdr2SystemSettingsXml returned a
// value instead of throwing. requireOneTag used to filter to occurrences
// matching the REQUESTED shape before checking for duplicates, so a tag
// present once in each shape (one real, one stray) found exactly one
// shape-matching occurrence and used it, silently discarding the other
// rather than refusing the ambiguity. Separately, parseXmlElements' attribute
// loop kept whichever `value="..."` it saw LAST within one element, so two
// `value` attributes on the same self-closing tag silently picked the second.

describe('a critical tag with conflicting definitions in different shapes is refused, not silently resolved', () => {
  it('rejects a tag that appears once as text and once as a self-closing value attribute', () => {
    const mixedShapeDuplicate = REAL_SYSTEM_XML.replace(
      '<textureQuality>kSettingLevel_Ultra</textureQuality>',
      '<textureQuality>kSettingLevel_Ultra</textureQuality>\n    <textureQuality value="1" />',
    );
    expect(() => parseRdr2SystemSettingsXml(mixedShapeDuplicate)).toThrow(Rdr2SettingsFormatError);
    expect(() => parseRdr2SystemSettingsXml(mixedShapeDuplicate)).toThrow(/<textureQuality> appears 2 times/);
  });

  it('rejects the same conflict the other way around: a value-attr tag duplicated with a text-shaped one', () => {
    const mixedShapeDuplicate = REAL_SYSTEM_XML.replace(
      '<screenWidth value="1920" />',
      '<screenWidth value="1920" />\n    <screenWidth>2560</screenWidth>',
    );
    expect(() => parseRdr2SystemSettingsXml(mixedShapeDuplicate)).toThrow(/<screenWidth> appears 2 times/);
  });
});

describe('a duplicate attribute name within one element is refused, not resolved to the last one seen', () => {
  it('rejects two "value" attributes on the same self-closing tag', () => {
    const duplicateValueAttr = REAL_SYSTEM_XML.replace(
      '<screenWidth value="1920" />',
      '<screenWidth value="1920" value="2560" />',
    );
    expect(() => parseRdr2SystemSettingsXml(duplicateValueAttr)).toThrow(Rdr2SettingsFormatError);
    expect(() => parseRdr2SystemSettingsXml(duplicateValueAttr)).toThrow(
      /<screenWidth> has the attribute "value" more than once/,
    );
  });

  it('rejects a duplicated non-"value" attribute too, not just "value" itself', () => {
    const duplicateOtherAttr = REAL_SYSTEM_XML.replace(
      '<screenWidth value="1920" />',
      '<screenWidth value="1920" extra="a" extra="b" />',
    );
    expect(() => parseRdr2SystemSettingsXml(duplicateOtherAttr)).toThrow(/has the attribute "extra" more than once/);
  });
});

describe('the windowed-mode resolution pair is preserved raw, never used to pick an active resolution', () => {
  it('parses screenWidthWindowed and screenHeightWindowed as their own fields', () => {
    const parsed = parseRdr2SystemSettingsXml(REAL_SYSTEM_XML);
    expect(parsed.display.screenWidthWindowed).toBe(1920);
    expect(parsed.display.screenHeightWindowed).toBe(1080);
  });

  it('parses a genuinely different windowed-mode resolution independently of the fullscreen one', () => {
    const differentWindowedRes = REAL_SYSTEM_XML.replace(
      '<screenWidthWindowed value="1920" />\n    <screenHeightWindowed value="1080" />',
      '<screenWidthWindowed value="1280" />\n    <screenHeightWindowed value="720" />',
    );
    const parsed = parseRdr2SystemSettingsXml(differentWindowedRes);
    expect(parsed.display.screenWidth).toBe(1920);
    expect(parsed.display.screenHeight).toBe(1080);
    expect(parsed.display.screenWidthWindowed).toBe(1280);
    expect(parsed.display.screenHeightWindowed).toBe(720);
  });

  it('requires screenWidthWindowed/screenHeightWindowed just like the fullscreen pair — missing is rejected, not defaulted', () => {
    const missing = REAL_SYSTEM_XML.replace('<screenWidthWindowed value="1920" />', '');
    expect(() => parseRdr2SystemSettingsXml(missing)).toThrow(/Missing required <screenWidthWindowed>/);
  });

  // The actual proof that no decision is made: the result type itself has no
  // "active" or "effective" resolution field, only the two raw pairs plus the
  // undecoded windowed code — there is nothing to assert IS the active one.
  it('exposes no derived "active resolution" field on the parsed result', () => {
    const parsed = parseRdr2SystemSettingsXml(REAL_SYSTEM_XML);
    const displayKeys = Object.keys(parsed.display).sort();
    expect(displayKeys).toEqual(
      ['screenHeight', 'screenHeightWindowed', 'screenWidth', 'screenWidthWindowed', 'vSync', 'windowed'].sort(),
    );
  });
});

describe('the known value sets are closed, not open-ended', () => {
  it('lists exactly the quality levels this parser was built against', () => {
    expect(RDR2_QUALITY_LEVELS).toEqual([
      'kSettingLevel_Low',
      'kSettingLevel_Medium',
      'kSettingLevel_High',
      'kSettingLevel_Ultra',
      'kSettingLevel_Custom',
    ]);
  });

  it('lists exactly the graphics APIs this parser was built against — DX11 deliberately absent', () => {
    expect(RDR2_GRAPHICS_APIS).toEqual(['kSettingAPI_Vulkan', 'kSettingAPI_DX12']);
    expect(RDR2_GRAPHICS_APIS).not.toContain('kSettingAPI_DX11');
  });
});

// ---------------------------------------------------------------------------
// Locating system.xml
// ---------------------------------------------------------------------------

describe('finding system.xml in its real locations', () => {
  // path.win32.join, not path.join: these paths must match what the module
  // produces regardless of which OS runs this suite — see the module's own
  // comment on candidateRdr2SettingsPaths for why.
  const documentsPath = (home: string) =>
    path.win32.join(home, 'Documents', 'Rockstar Games', 'Red Dead Redemption 2', 'Settings', 'system.xml');
  const oneDrivePath = (base: string) =>
    path.win32.join(base, 'Documents', 'Rockstar Games', 'Red Dead Redemption 2', 'Settings', 'system.xml');

  it('always includes the normal Documents location', () => {
    const candidates = candidateRdr2SettingsPaths({ homedir: () => 'C:\\Users\\Aaron', env: {} });
    expect(candidates.map((c) => c.path)).toContain(documentsPath('C:\\Users\\Aaron'));
    expect(candidates.find((c) => c.path === documentsPath('C:\\Users\\Aaron'))?.source).toBe('documents');
  });

  it('includes the OneDrive location when Windows reports one', () => {
    const candidates = candidateRdr2SettingsPaths({
      homedir: () => 'C:\\Users\\Aaron',
      env: { OneDriveConsumer: 'C:\\Users\\Aaron\\OneDrive' },
    });
    const oneDrive = candidates.find((c) => c.path === oneDrivePath('C:\\Users\\Aaron\\OneDrive'));
    expect(oneDrive?.source).toBe('onedrive');
  });

  it('includes a work/school OneDrive location too', () => {
    const candidates = candidateRdr2SettingsPaths({
      homedir: () => 'C:\\Users\\Aaron',
      env: { OneDriveCommercial: 'C:\\Users\\Aaron\\OneDrive - Some Company' },
    });
    expect(candidates.map((c) => c.path)).toContain(oneDrivePath('C:\\Users\\Aaron\\OneDrive - Some Company'));
  });

  it('de-duplicates candidates that resolve to the identical path', () => {
    const candidates = candidateRdr2SettingsPaths({
      homedir: () => 'C:\\Users\\Aaron',
      env: {
        OneDrive: 'C:\\Users\\Aaron\\OneDrive',
        OneDriveConsumer: 'C:\\Users\\Aaron\\OneDrive',
      },
    });
    const oneDriveMatches = candidates.filter((c) => c.path === oneDrivePath('C:\\Users\\Aaron\\OneDrive'));
    expect(oneDriveMatches).toHaveLength(1);
  });

  it('ignores an empty-string env var rather than treating it as a real location', () => {
    const candidates = candidateRdr2SettingsPaths({ homedir: () => 'C:\\Users\\Aaron', env: { OneDrive: '' } });
    expect(candidates).toHaveLength(1);
  });

  it('picks the single candidate that actually exists on disk', () => {
    const home = 'C:\\Users\\Aaron';
    const target = documentsPath(home);
    const location = locateRdr2SettingsFile({
      homedir: () => home,
      env: {},
      fsLike: { existsSync: (p) => p === target },
    });
    expect(location).toEqual({ path: target, source: 'documents' });
  });

  it('REFUSES when no candidate exists anywhere', () => {
    expect(() =>
      locateRdr2SettingsFile({ homedir: () => 'C:\\Users\\Aaron', env: {}, fsLike: { existsSync: () => false } }),
    ).toThrow(Rdr2SettingsNotFoundError);
  });

  it('REFUSES when more than one candidate exists, rather than picking by priority', () => {
    expect(() =>
      locateRdr2SettingsFile({
        homedir: () => 'C:\\Users\\Aaron',
        env: { OneDriveConsumer: 'C:\\Users\\Aaron\\OneDrive' },
        fsLike: { existsSync: () => true },
      }),
    ).toThrow(Rdr2SettingsAmbiguousLocationError);
  });
});

// ---------------------------------------------------------------------------
// readRdr2SystemSettings — the full read -> hash -> parse path
// ---------------------------------------------------------------------------

function fakeFs(files: Record<string, Buffer>): ReadFsLike {
  return {
    existsSync: (p: string) => p in files,
    readFileSync: (p: string) => {
      const f = files[p];
      if (!f) throw new Error(`ENOENT: ${p}`);
      return f;
    },
  };
}

describe('reading system.xml end to end', () => {
  const settingsPath = 'C:\\Users\\Aaron\\Documents\\Rockstar Games\\Red Dead Redemption 2\\Settings\\system.xml';
  const bytes = Buffer.from(REAL_SYSTEM_XML, 'utf-8');

  it('preserves the raw text and its SHA-256 exactly, alongside the parsed fields', () => {
    const result = readRdr2SystemSettings({
      homedir: () => 'C:\\Users\\Aaron',
      env: {},
      fsLike: fakeFs({ [settingsPath]: bytes }),
      platform: 'win32',
    });

    expect(result.raw).toBe(REAL_SYSTEM_XML);
    expect(result.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(result.location).toEqual({ path: settingsPath, source: 'documents' });
    expect(result.schemaVersion).toBe(37);
    expect(result.graphics.api).toBe('kSettingAPI_Vulkan');
  });

  it('an explicit path bypasses the locator entirely, and is still read-only', () => {
    const explicit = 'D:\\backup\\system.xml';
    const result = readRdr2SystemSettings({
      explicitPath: explicit,
      fsLike: fakeFs({ [explicit]: bytes }),
      platform: 'win32',
    });
    expect(result.location).toEqual({ path: explicit, source: 'explicit' });
  });

  it('REFUSES off Windows, with no fallback path', () => {
    expect(() =>
      readRdr2SystemSettings({
        homedir: () => '/home/aaron',
        env: {},
        fsLike: fakeFs({}),
        platform: 'linux',
      }),
    ).toThrow(/Windows-only/);
  });

  it('propagates the same fail-closed content validation as the pure parser', () => {
    const corrupt = Buffer.from(REAL_SYSTEM_XML.replace('kSettingAPI_Vulkan', 'kSettingAPI_DX11'), 'utf-8');
    expect(() =>
      readRdr2SystemSettings({
        homedir: () => 'C:\\Users\\Aaron',
        env: {},
        fsLike: fakeFs({ [settingsPath]: corrupt }),
        platform: 'win32',
      }),
    ).toThrow(Rdr2SettingsFormatError);
  });

  it('never calls anything on fsLike beyond existsSync and readFileSync', () => {
    const touched = new Set<string>();
    const poisoned = new Proxy(fakeFs({ [settingsPath]: bytes }), {
      get(target, prop: string) {
        touched.add(prop);
        // @ts-expect-error -- deliberately dynamic for this proof
        return target[prop];
      },
    });
    readRdr2SystemSettings({ homedir: () => 'C:\\Users\\Aaron', env: {}, fsLike: poisoned, platform: 'win32' });
    expect([...touched].sort()).toEqual(['existsSync', 'readFileSync']);
  });
});
