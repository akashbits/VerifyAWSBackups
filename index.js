'use strict';
/*********************************** */
// Name : check-ami-availability
// Purpose : Script to report all the available AMI for each of the Instances and send a email
// Started Date : 13 May 2018
// Completed Date : 17 May 2018
/*********************************** */

var config = require('./config')[process.env.AWS_ENVIRONMENT];
if (!config) config = require('./config')['prod'];
var aws = require('aws-sdk');
aws.config.update({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey
});
var ec2Main = new aws.EC2({
    region: config.defaultRegion
});
exports.handler = function(event, context) {


    //Implementation Logic
    /*

    Get All available regions,
        Loop through all regions
            Get All the Instances in this account
                Get All the Snapshots based on Unique VolumeIds from the Instances List
                Get All the AMI Images along with SnapshotId using owner self account
                Identify the AMI connected with the Instance using InstanceId->VolumId->SnapshotId->AMIId
                    Create the Summary
                    Prepare the Summary for Email Body
                    Send the Mail uses SES


    */
    var regionsProcessed = 0;
    let regions = ["us-east-1"]; // for testing purposes.
    let instanceSummaryList = [];

    //Loop through the regions
    getAllRegions(function(regionList) {
        //Comment this out to use the static regions defined in the top.
        regions = regionList;
        regions.forEach(function(region) {
            getInstanceSummary(region, function(region, instanceSummary) {
                regionsProcessed++;
                instanceSummaryList.push({
                    region: region,
                    instances: instanceSummary
                });
                if (regionsProcessed == regions.length) {

                    let reportContent = prepareReportForEmail(regions, instanceSummaryList);
                    sendMail(config.fromMailId, config.toMailId, reportContent);
                };
            });
        });
    });

};

function prepareReportByDayInterval(regions, instanceSummaryList, dayIntervalStart, dayIntervalEnd) {

    var reportLogs = [];
    regions.forEach(region => {
        var lineContent = [];
        var regionwiseInfo = instanceSummaryList.filter(ecInst => {
            return ecInst.region == region;
        }).pop();
        var instancesFinal = regionwiseInfo.instances.filter(sItem => {
            return sItem.recentAMIAge >= dayIntervalStart && sItem.recentAMIAge <= dayIntervalEnd;
        });
        if (instancesFinal.length > 0) {}

        instancesFinal.forEach(regionIns => {
            var amiDetail = "";
            if (regionIns.hasImage) {
                amiDetail = regionIns.amis[0];
                lineContent.push(region + " " + regionIns.instanceId + "\t" + String(amiDetail.daysOld) + " day(s) old" + "\t" + amiDetail.amiId);
            }

        });
        if (instancesFinal.length > 0) {
            //lineContent.push("\n----------------Ends for Region " + region  + "--------------------\n");
            reportLogs.push(lineContent.join("\n"));
        }
    });

    return reportLogs;

}

function prepareReportForEmail(regions, instanceSummaryList) {


    let reportLogs = [];
    reportLogs.push("================================================");
    reportLogs.push("AMI's which are less than 30 days old");
    reportLogs.push("================================================");
    reportLogs.push("Region | InstanceId | Days | ImageId");
    reportLogs.push("------------------------------------------------");
    var cont = prepareReportByDayInterval(regions, instanceSummaryList, 0, 30);
    reportLogs.push(cont);

    reportLogs.push("================================================");
    reportLogs.push("AMI's which are greater than 30 days old");
    reportLogs.push("================================================");
    reportLogs.push("Region | InstanceId | Days | ImageId");
    reportLogs.push("------------------------------------------------");
    cont = prepareReportByDayInterval(regions, instanceSummaryList, 31, 99);
    reportLogs.push(cont);
    var finalCont = reportLogs.join("\n");

    console.log(finalCont);
    return finalCont;

}

function getAllRegions(callback) {

    ec2Main.describeRegions({}, function(err, data) {
		if (err) console.log(err, err.stack);
        else {
			var regions = [];
			data.Regions.forEach(function(rgn) {
				regions.push(rgn.RegionName);

			});
			callback(regions);
		}
    });

}

function getInstanceSummary(region, callback) {
    console.log("Extracting data for Region " + region);
    var ec2 = new aws.EC2({
        region: region
    });
    var instances = [];
    var snapshots = [];
    let amiList = []

    var instanceparams = {
        Filters: [{
            Name: 'tag:' + config.instanceFilterTagKey,
            Values: [config.instanceFilterTagValue]
        }]
    }

    //instanceparams={};
    ec2.describeInstances(instanceparams, function(err, data) {

        if (err) console.log(err, err.stack);
        else {
	             //Get the Instance and Volume Details
            for (var i in data.Reservations) {
                let instList = data.Reservations[i].Instances;
                for (var j in instList) {
					
                    let instance = instList[j];
	                let instanceId = instance.InstanceId;
                    let rootDeviceName = instance.RootDeviceName;
                    let volumes = instance.BlockDeviceMappings.filter(function(vitem) {
                        return vitem.DeviceName == rootDeviceName;
                    });
                    let volumeId = "";
                    if (volumes.length > 0) {
                        volumeId = volumes.pop().Ebs.VolumeId;
                    }
                    let insInfo = {
                        instanceId: instanceId,
                        volumeId: volumeId,
                        rootDeviceName: rootDeviceName
                    };
                    instances.push(insInfo);
                    //break;
                }
            }

            let volumeIds = instances.map(vItem => {
                return vItem.volumeId
            });
            volumeIds = volumeIds.filter(vItem => {
                return vItem != ''
            });
            let snapshots = [];


            //Get all the Snapshots 
            var snapShotParams = {
                Filters: [{
                    Name: 'volume-id',
                    Values: volumeIds
                }]
            };

            ec2.describeSnapshots(snapShotParams, function(err, data) {

                data.Snapshots.forEach(function(snpshot) {
                    //This logic is no more used
                    //let regPattern=/Created by CreateImage\((.*?)\) for (.*?) /;
                    //let matched=snpshot.Description.match(regPattern);
                    //let insId=matched[1];
                    ///let amiImageId=matched[2];
                    snapshots.push({
                        instanceId: '',
                        startTime: snpshot.StartTime,
                        volumeId: snpshot.VolumeId,
                        description: snpshot.Description,
                        snapshotId: snpshot.SnapshotId
                    });

                });

                //let amiImageIds=snapshots.map(sItem=>{ return sItem.amiId});
                var imageParams = {
                    Owners: ["self"]
                };

                ec2.describeImages(imageParams, function(err, data) {
					if (err) {
						if (err) console.log(err, err.stack);
					} else {
						data.Images.forEach(function(img) {

							if (img.BlockDeviceMappings.length > 0 && img.Public == false) {
								let snapshotId = img.BlockDeviceMappings[0].Ebs.SnapshotId;
								amiList.push({
									snapshotId: snapshotId,
									createdDate: img.CreationDate,
									name: img.Name,
									imgId: img.ImageId,
									description: img.Description
								});
							}
						});
					}

                    let instanceSummary = prepareInstanceSummary(instances, snapshots, amiList);
                    callback(region, instanceSummary);
                });


            });

        }

    });

};

function prepareInstanceSummary(_instanceList, _snapshotList, _amiList) {

    _instanceList.forEach(function(inst) {

        inst.amis = [];
        inst.recentAMIAge = 0;
        let volId = inst.volumeId;
        let snapshots = _snapshotList.filter(vSnapshot => {
            return vSnapshot.volumeId == volId;
        });

        snapshots.forEach(function(snpsht) {
            let amiInfo = _amiList.filter(amiItem => {
                return amiItem.snapshotId == snpsht.snapshotId;
            });

            if (amiInfo.length > 0) {
                let amiCreatedDate = amiInfo[0].createdDate;
                var diffDays = parseInt((new Date() - new Date(amiCreatedDate)) / (1000 * 60 * 60 * 24));

                inst.amis.push({
                    daysOld: diffDays,
                    amiId: amiInfo[0].imgId,
                    createdDate: amiCreatedDate
                });
                inst.hasImage = true;
            }
        });

        inst.amis.sort(function(a, b) {
            return b.daysOld - a.daysOld;
        });

         if(inst.hasImage) {
            inst.recentAMIAge =inst.amis[inst.amis.length-1].daysOld;
            inst.amiDetail=inst.amis[inst.amis.length-1];
            inst.amis=[inst.amiDetail];
        }

    });

    //console.log(JSON.stringify(_instanceList.filter(g=>{return g.instanceId=="i-0f6c1c038c2043ec4";})));
    return _instanceList;

};

function sendMail(from, to, reportContent) {

    var htmlCont = reportContent.replace(/\n/g, "<br>");
    var params = {
        Destination: {

            ToAddresses: [
                to
            ]
        },
        Message: {
            Body: {
                Html: {
                    Charset: "UTF-8",
                    Data: htmlCont
                },
                Text: {
                    Charset: "UTF-8",
                    Data: reportContent
                }
            },
            Subject: {
                Charset: 'UTF-8',
                Data: 'AWS - AMI Image Details'
            }
        },
        Source: from
    };


    var sendPromise = new aws.SES({
        apiVersion: '2010-12-01'
    }).sendEmail(params).promise();
    // Handle promise's fulfilled/rejected states
    sendPromise.then(
        function(data) {
            console.log("Mail Sent " + data.MessageId);
        }).catch(
        function(err) {
            console.error(err, err.stack);
        });

}
