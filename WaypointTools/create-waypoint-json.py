# This parses the APT.txt, NAV.txt and FIX.txt files loaded from the FAA database downloaded from
# https://nfdc.faa.gov/xwiki/bin/view/NFDC/56+Day+NASR+Subscription
# Run this file on the unzipped driectory that is downloaded.

import re

latLongRE = re.compile('\s*(\d+)-(\d{2})-(\d{2}.\d{3,8})([NS])\s*(\d+)-(\d{2})-(\d{2}.\d{3,8})([EW])')
statesToInclude = ['CALIFORNIA', 'IDAHO', 'OREGON', 'WASHINGTON', 'NEVADA', 'ARIZONA']
statesAbbreviationsToInclude = ['CA', 'ID', 'OR', 'WA', 'NV', 'AZ']
navaidsToInclude = ['VOR']  # Don't include NDB's because there are duplicates with VOR names.

class WaypointData:
    def __init__(self):
        self.waypoints = []

    def parseLatLongDMS(self, latLongString):
        match = latLongRE.match(latLongString)
        latitude = float(match.group(1)) + (float(match.group(2)) * 60 + float(match.group(3))) / 3600
        if match.group(4) == 'S':
            latitude = -latitude

        longitude = float(match.group(5)) + (float(match.group(6)) * 60 + float(match.group(7))) / 3600
        if match.group(8) == 'W':
            longitude = -longitude

        return (latitude, longitude)

    def parseAirportData(self, airportFile):
        file = open(airportFile, 'r')

        for line in file:
            if line[0:3] != 'APT':
                continue

            if not line[48:50] in statesAbbreviationsToInclude:
                continue

            facilityType = line[14:27].rstrip().title()

            latLong = self.parseLatLongDMS(line[523:538]+line[550:565])

            description = line[133:183].rstrip().title() + ' ' + facilityType + ', ' + line[93:133].rstrip().title() + ', ' + line[48:50]
            name = line[1210:1217].rstrip()
            if not len(name):
                name = line[27:31].rstrip()

            self.waypoints.append((name, facilityType, description, latLong[0], latLong[1]))

        file.close()

    def parseNavAidData(self, navaidFile):
        file = open(navaidFile, 'r')

        for line in file:
            if line[0:4] != 'NAV1':
                continue

            if not line[142:144] in statesAbbreviationsToInclude:
                continue

            if not line[8:11] in navaidsToInclude:
                continue

            facilityType = line[8:28].rstrip()

            latLong = self.parseLatLongDMS(line[371:385]+line[396:410])

            name = line[4:8].rstrip()
            description = line[42:72].rstrip().title() + ' ' + line[8:28].rstrip()

            self.waypoints.append((name, facilityType, description, latLong[0], latLong[1]))

        file.close()


    def parseFixData(self, fixFile):
        file = open(fixFile, 'r')

        for line in file:
            if line[0:4] != 'FIX1':
                continue

            if not line[34:64].rstrip() in statesToInclude:
                continue

            if line[4] < 'A' or line[4] > 'Z':
                continue

            facilityType = 'Intersection'

            latLong = self.parseLatLongDMS(line[66:80]+line[80:94])

            name = line[4:34].rstrip()
            description = name + ' Intersection'

            self.waypoints.append((name, facilityType, description, latLong[0], latLong[1]))

        file.close()


    def outputWaypointFile(self, outputFilename):
        sortedWaypoints = sorted(self.waypoints, key=lambda waypoint: waypoint[0])

        outputFile = open(outputFilename, 'w+')

        outputFile.write('var faaWaypoints = [\n');
        isFirst = True
        for waypoint in sortedWaypoints:
            if isFirst:
                isFirst = False
            else:
                outputFile.write(',\n');
            outputFile.write('    {{ \"name\":"{0}", \"type\":"{1}", \"description\":"{2}", \"latitude\":{3}, \"longitude\":{4}}}'.format(waypoint[0], waypoint[1], waypoint[2], waypoint[3], waypoint[4]))
        outputFile.write('\n];\n');


def main():
    waypoints = WaypointData()
    waypoints.parseAirportData('APT.txt')
    waypoints.parseNavAidData('NAV.txt')
    waypoints.parseFixData('FIX.txt')
    waypoints.outputWaypointFile('waypoints.json')

if __name__ == "__main__":
    main()
