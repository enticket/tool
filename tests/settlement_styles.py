"""Check exported OOXML independently against the settlement's intended styles."""
import zipfile
import xml.etree.ElementTree as ET

NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}


def assert_settlement_styles(path, expected):
    with zipfile.ZipFile(path) as archive:
        styles = ET.fromstring(archive.read('xl/styles.xml'))
        sheet = ET.fromstring(archive.read('xl/worksheets/sheet1.xml'))
    cells = {cell.attrib['r']: cell for cell in sheet.findall('.//s:sheetData/s:row/s:c', NS)}
    fonts = styles.find('s:fonts', NS)
    fills = styles.find('s:fills', NS)
    borders = styles.find('s:borders', NS)
    xfs = styles.find('s:cellXfs', NS)
    formats = {int(el.attrib['numFmtId']): el.attrib['formatCode'] for el in styles.find('s:numFmts', NS)}
    checked = 0
    for ref, cell in expected.items():
        if ref.startswith('!') or not cell.get('s'):
            continue
        assert ref in cells, ('missing formatted cell', ref)
        xml_cell = cells[ref]
        xf = xfs[int(xml_cell.attrib.get('s', 0))]
        style = cell['s']
        if 'font' in style:
            font = fonts[int(xf.attrib['fontId'])]
            assert font.find('s:name', NS).attrib['val'] == style['font']['name'], ref
            assert float(font.find('s:sz', NS).attrib['val']) == style['font']['sz'], ref
            assert (font.find('s:b', NS) is not None) == style['font'].get('bold', False), ref
            assert font.find('s:color', NS).attrib['rgb'] == style['font']['color']['rgb'], ref
        if 'fill' in style:
            fill = fills[int(xf.attrib['fillId'])].find('s:patternFill', NS)
            assert fill.attrib['patternType'] == style['fill']['patternType'], ref
            assert fill.find('s:fgColor', NS).attrib['rgb'] == style['fill']['fgColor']['rgb'], ref
        if 'border' in style:
            border = borders[int(xf.attrib['borderId'])]
            for side, value in style['border'].items():
                if not value:
                    continue
                edge = border.find('s:' + side, NS)
                assert edge.attrib.get('style') == value.get('style'), (ref, side)
                if value.get('color'):
                    assert edge.find('s:color', NS).attrib == value['color'], (ref, side)
        if 'alignment' in style:
            alignment = xf.find('s:alignment', NS)
            for key, value in style['alignment'].items():
                assert alignment.attrib[key] == str(int(value) if isinstance(value, bool) else value), (ref, key)
        if style.get('numFmt'):
            assert formats[int(xf.attrib['numFmtId'])] == style['numFmt'], ref
        if cell.get('f'):
            assert xml_cell.find('s:f', NS).text == cell['f'], ref
        checked += 1
    assert checked > 100, checked
    assert len(sheet.find('s:mergeCells', NS)) == len(expected['!merges'])
    assert sheet.find('s:pageSetup', NS).attrib['fitToWidth'] == '1'
    print(f'PASS: {checked} settlement cells preserve fonts, fills, borders, alignment, formats and formulas')
